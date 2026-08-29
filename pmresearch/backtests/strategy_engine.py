"""Unified strategy backtest engine — all strategies share execution/cost assumptions."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Callable

import pandas as pd

from pmresearch.backtests.metrics import compute_metrics, metrics_by_group
from pmresearch.config import Config
from pmresearch.data.loader import chronological_split
from pmresearch.execution.costs import simulate_market_order
from pmresearch.features.market_features import add_fair_value_features
from pmresearch.models.fair_value import compute_adjusted_probabilities
from pmresearch.regimes.classifier import RegimeConfig, classify_regimes, merge_regime_to_snapshots
from pmresearch.risk.circuit_breaker import CircuitBreakerConfig, CircuitBreakerState
from pmresearch.risk.exits import ExitReason, check_exit
from pmresearch.risk.exposure import ExposureState, OpenPosition, RiskLimits
from pmresearch.risk.position_sizing import PositionSizingMethod, compute_position_size
from pmresearch.strategies.base import TradeSignal
from pmresearch.strategies.fair_value import generate_signals as fair_value_signals
from pmresearch.strategies.mean_reversion import generate_signals as mean_reversion_signals
from pmresearch.strategies.momentum import generate_signals as momentum_signals
from pmresearch.strategies.order_flow import generate_signals as order_flow_signals
from pmresearch.strategies.regime_switch import generate_signals as regime_switch_signals

STRATEGIES: dict[str, Callable] = {
    "FAIR_VALUE": lambda df, cfg: fair_value_signals(df, min_edge=cfg["min_edge"], use_adjusted=False),
    "MEAN_REVERSION": lambda df, cfg: mean_reversion_signals(df, min_edge=cfg["min_edge"], z_threshold=cfg.get("z_threshold", 1.5)),
    "MOMENTUM": lambda df, cfg: momentum_signals(df, min_edge=cfg["min_edge"], persistence_threshold=cfg.get("persistence_threshold", 0.5)),
    "ORDER_FLOW": lambda df, cfg: order_flow_signals(df, min_edge=cfg["min_edge"]),
    "REGIME_SWITCH": lambda df, cfg: regime_switch_signals(df, min_edge=cfg["min_edge"], uncertain_mode=cfg.get("uncertain_mode", "fair_value")),
}

STRATEGY_INTERNAL_MAP = {
    "FAIR_VALUE": "fair_value",
    "MEAN_REVERSION": "mean_reversion",
    "MOMENTUM": "momentum",
    "ORDER_FLOW": "order_flow",
    "REGIME_SWITCH": None,
}


class StrategyBacktestEngine:
    """Common backtest engine for all research strategies."""

    def __init__(self, config: Config):
        self.config = config
        raw = config.raw
        r = raw.get("regime", {})
        risk = raw.get("risk", {})
        self.strategy_cfg = {
            "min_edge": r.get("min_edge", 0.02),
            "z_threshold": r.get("z_threshold", 1.5),
            "persistence_threshold": r.get("persistence_threshold", 0.5),
            "uncertain_mode": r.get("uncertain_mode", "fair_value"),
        }
        self.regime_cfg = RegimeConfig(
            ma_window=r.get("ma_window", 20),
            z_mr_threshold=r.get("z_threshold", 1.5),
            persistence_mom_min=r.get("persistence_threshold", 0.5),
        )
        self.risk_limits = RiskLimits(
            max_position_risk_pct=risk.get("max_position_risk_pct", 0.15),
            max_asset_exposure_pct=risk.get("max_asset_exposure_pct", r.get("per_asset_limit_pct", 0.25)),
            max_directional_crypto_exposure_pct=risk.get("max_directional_crypto_exposure_pct", 0.30),
            max_total_portfolio_exposure_pct=risk.get("max_total_portfolio_exposure_pct", 0.50),
        )
        self.cb_config = CircuitBreakerConfig(
            daily_loss_limit_pct=risk.get("daily_loss_limit_pct", r.get("daily_loss_limit_pct", 0.05)),
            max_portfolio_drawdown_pct=risk.get("max_drawdown_pct", r.get("max_drawdown_pct", 0.15)),
            max_consecutive_losses=risk.get("max_consecutive_losses", 10),
        )
        sizing = risk.get("position_sizing_method", "EDGE_WEIGHTED")
        self.sizing_method = PositionSizingMethod(sizing)

    def prepare_data(self, df: pd.DataFrame) -> pd.DataFrame:
        df = add_fair_value_features(df)
        df = compute_adjusted_probabilities(df)

        crypto_cols = ["asset", "timestamp", "spot_price", "realized_vol_1h", "order_book_imbalance", "return_1m"]
        if "volume" in df.columns:
            tmp = df.copy()
            tmp["volume_24h"] = tmp["volume"]
            crypto_cols.append("volume_24h")
        elif "volume_24h" in df.columns:
            crypto_cols.append("volume_24h")
        avail = [c for c in crypto_cols if c in df.columns]
        regime_df = classify_regimes(df[avail].drop_duplicates(["asset", "timestamp"]), self.regime_cfg)
        df = merge_regime_to_snapshots(df, regime_df)
        df = df.sort_values(["market_id", "timestamp"])
        df["prob_change"] = df.groupby("market_id")["market_probability"].diff().fillna(0)
        return df

    def run_strategy(self, df: pd.DataFrame, strategy_name: str, split_name: str = "test") -> tuple[pd.DataFrame, dict[str, Any]]:
        if strategy_name not in STRATEGIES:
            raise ValueError(f"Unknown strategy: {strategy_name}")
        signals = STRATEGIES[strategy_name](df, self.strategy_cfg)
        trades, cb = self._simulate(df, signals, strategy_name)
        metrics = compute_metrics(trades, self.config.initial_capital)
        metrics.update({
            "strategy": strategy_name,
            "split": split_name,
            "circuit_breaker": cb,
            "by_asset": metrics_by_group(trades, "asset", self.config.initial_capital) if not trades.empty else {},
            "by_duration": metrics_by_group(trades, "duration_minutes", self.config.initial_capital) if not trades.empty and "duration_minutes" in trades.columns else {},
            "by_regime": metrics_by_group(trades, "regime", self.config.initial_capital) if not trades.empty and "regime" in trades.columns else {},
        })
        if not trades.empty and "predicted_edge" in trades.columns:
            metrics["avg_predicted_edge"] = float(trades["predicted_edge"].mean())
        return trades, metrics

    def compare_all(self, df: pd.DataFrame, split_name: str = "test") -> dict[str, Any]:
        prepared = self.prepare_data(df) if "regime" not in df.columns else df
        results, all_trades = {}, {}
        for name in STRATEGIES:
            trades, metrics = self.run_strategy(prepared, name, split_name)
            results[name] = metrics
            all_trades[name] = trades
        return {
            "strategies": results,
            "trades": all_trades,
            "config": self.strategy_cfg,
            "split": split_name,
        }

    def run_oos_comparison(self, df: pd.DataFrame) -> dict[str, Any]:
        prepared = self.prepare_data(df)
        _, _, test = chronological_split(
            prepared, train_pct=self.config.train_pct, val_pct=self.config.validation_pct
        )
        result = self.compare_all(test, split_name="test")
        result["test_size"] = len(test)
        return result

    def _simulate(self, df: pd.DataFrame, signals: list[TradeSignal], strategy_name: str) -> tuple[pd.DataFrame, dict]:
        signal_map: dict[tuple, list[TradeSignal]] = {}
        for s in signals:
            signal_map.setdefault((s.market_id, s.timestamp), []).append(s)

        exposure = ExposureState(limits=self.risk_limits)
        cb = CircuitBreakerState(self.cb_config, self.config.initial_capital)
        open_positions: dict[str, OpenPosition] = {}
        closed: list[dict] = []
        equity = self.config.initial_capital
        internal = STRATEGY_INTERNAL_MAP.get(strategy_name)

        for row in df.sort_values("timestamp").itertuples(index=False):
            ts = row.timestamp
            trade_date = ts.date() if hasattr(ts, "date") else date.today()

            to_close = []
            for pid, pos in open_positions.items():
                if pos.market_id != row.market_id:
                    continue
                mp = getattr(row, "adjusted_probability", None) or getattr(row, "baseline_probability_yes", 0.5)
                depth = row.yes_ask_depth if pos.side == "YES" else row.no_ask_depth
                ask = row.executable_yes if pos.side == "YES" else row.executable_no
                liq = depth * ask
                exit_sig = check_exit(
                    pos, row.yes_bid, row.yes_ask, row.no_bid, row.no_ask,
                    model_probability=mp, current_regime=getattr(row, "regime", "UNCERTAIN"),
                    time_remaining_seconds=row.time_remaining_seconds,
                    min_edge=self.strategy_cfg["min_edge"],
                    available_liquidity_usd=liq,
                    uncertainty_buffer=getattr(row, "uncertainty_buffer", 0.01),
                    max_position_loss_pct=self.risk_limits.max_position_risk_pct,
                )
                if exit_sig.should_exit or cb.triggered:
                    reason = ExitReason.CIRCUIT_BREAKER if cb.triggered else exit_sig.reason
                    pnl = self._calc_pnl(pos, row.settlement_result)
                    closed.append(self._record(pos, pnl, reason, row))
                    equity += pnl
                    cb.record_trade(pnl, trade_date)
                    to_close.append(pid)

            for pid in to_close:
                exposure.remove(pid)
                del open_positions[pid]

            cb.update_equity(equity, trade_date)
            if not cb.can_trade():
                continue

            for sig in signal_map.get((row.market_id, ts), []):
                if internal and sig.strategy != internal:
                    continue
                if any(p.market_id == row.market_id for p in open_positions.values()):
                    continue

                yes_ask, no_ask = row.executable_yes, row.executable_no
                depth = row.yes_ask_depth if sig.side == "YES" else row.no_ask_depth
                liq = depth * (yes_ask if sig.side == "YES" else no_ask)
                corr = exposure.correlated_exposure(sig.asset, sig.side, equity)
                size = compute_position_size(
                    method=self.sizing_method,
                    net_edge=sig.gross_edge,
                    min_edge=self.strategy_cfg["min_edge"],
                    model_confidence=sig.confidence,
                    realized_vol=getattr(row, "realized_vol", 0.5) or 0.5,
                    available_liquidity_usd=liq,
                    correlated_exposure_pct=corr,
                    portfolio_value=equity,
                    base_size_usd=self.config.raw.get("risk", {}).get("base_size_usd", 100.0),
                    max_size_usd=self.config.raw.get("risk", {}).get("max_size_usd", 500.0),
                    correlated_limit_pct=self.risk_limits.correlated_exposure_limit_pct,
                )
                if size <= 0 or not exposure.can_add(sig.asset, sig.side, size, equity):
                    continue

                ex = simulate_market_order(
                    sig.side, size, yes_ask, no_ask,
                    row.yes_ask_depth, row.no_ask_depth,
                    self.config.exchange_fee_pct, self.config.slippage_bps,
                    self.config.min_liquidity_usd,
                )
                if not ex.filled:
                    continue

                pid = str(uuid.uuid4())[:8]
                open_positions[pid] = OpenPosition(
                    position_id=pid, market_id=sig.market_id, asset=sig.asset,
                    side=sig.side, entry_price=ex.fill_price, size_usd=ex.fill_size_usd,
                    entry_timestamp=ts, strategy=sig.strategy, regime_at_entry=sig.regime,
                    model_probability=sig.model_probability,
                    time_remaining_seconds=row.time_remaining_seconds,
                    duration_minutes=sig.duration_minutes,
                    entry_reason=sig.entry_reason, predicted_edge=sig.gross_edge,
                )
                exposure.add(open_positions[pid])

        for pos in list(open_positions.values()):
            last = df[df["market_id"] == pos.market_id].iloc[-1]
            pnl = self._calc_pnl(pos, last.settlement_result)
            closed.append(self._record(pos, pnl, ExitReason.SETTLEMENT, last))
            equity += pnl

        return pd.DataFrame(closed) if closed else pd.DataFrame(), cb.diagnostic_report()

    def _calc_pnl(self, pos: OpenPosition, settlement: int) -> float:
        fee = pos.size_usd * self.config.exchange_fee_pct
        if pos.side == "YES":
            return pos.size_usd * (settlement - pos.entry_price) - fee
        return pos.size_usd * ((1 - settlement) - pos.entry_price) - fee

    def _record(self, pos: OpenPosition, pnl: float, reason, snap) -> dict:
        realized = (snap.settlement_result - pos.entry_price) if pos.side == "YES" else ((1 - snap.settlement_result) - pos.entry_price)
        return {
            "market_id": pos.market_id, "asset": pos.asset, "timestamp": pos.entry_timestamp,
            "side": pos.side, "entry_price": pos.entry_price,
            "exit_price": float(snap.settlement_result) if pos.side == "YES" else float(1 - snap.settlement_result),
            "size_usd": pos.size_usd, "gross_edge": pos.predicted_edge, "predicted_edge": pos.predicted_edge,
            "realized_edge": realized, "fees": pos.size_usd * self.config.exchange_fee_pct,
            "slippage": 0.0, "pnl": pnl, "settlement_result": snap.settlement_result,
            "time_remaining_seconds": pos.time_remaining_seconds,
            "duration_minutes": pos.duration_minutes, "strategy": pos.strategy,
            "regime": pos.regime_at_entry, "entry_reason": pos.entry_reason,
            "exit_reason": str(reason),
        }
