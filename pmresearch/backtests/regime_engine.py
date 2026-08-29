"""Portfolio-level regime backtest with exits, sizing, correlation, circuit breaker."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pandas as pd

from pmresearch.backtests.metrics import compute_metrics, metrics_by_group
from pmresearch.config import Config
from pmresearch.execution.circuit_breaker import CircuitBreakerConfig, CircuitBreakerState
from pmresearch.execution.correlation import ExposureState, OpenPosition
from pmresearch.execution.costs import simulate_market_order
from pmresearch.execution.exit_logic import ExitReason, check_exit
from pmresearch.execution.position_sizing import compute_position_size
from pmresearch.features.market_features import add_fair_value_features
from pmresearch.features.regime import classify_regimes, merge_regime_to_snapshots
from pmresearch.models.fair_value import compute_fair_probabilities
from pmresearch.models.regime_fair_value import regime_adjusted_probability
from pmresearch.strategies.regime_signals import (
    TradeSignal,
    fair_value_signals,
    mean_reversion_signals,
    momentum_signals,
    order_flow_signals,
    regime_switching_signals,
)

SIGNAL_GENERATORS = {
    "fair_value_only": lambda df, min_edge: fair_value_signals(df, min_edge=min_edge, use_adjusted=False),
    "mean_reversion_only": lambda df, min_edge: mean_reversion_signals(df, min_edge=min_edge),
    "momentum_only": lambda df, min_edge: momentum_signals(df, min_edge=min_edge),
    "order_flow_only": lambda df, min_edge: order_flow_signals(df, min_edge=min_edge),
    "regime_switching": lambda df, min_edge: regime_switching_signals(df, min_edge=min_edge),
}


COMPONENT_STRATEGY_MAP = {
    "fair_value_only": "fair_value",
    "mean_reversion_only": "mean_reversion",
    "momentum_only": "momentum",
    "order_flow_only": "order_flow",
    "regime_switching": None,
}


class RegimeBacktestRunner:
    def __init__(self, config: Config):
        self.config = config
        self.cb_config = CircuitBreakerConfig(
            daily_loss_limit_pct=config.raw.get("regime", {}).get("daily_loss_limit_pct", 0.05),
            max_portfolio_drawdown_pct=config.raw.get("regime", {}).get("max_drawdown_pct", 0.15),
        )

    def prepare_data(self, df: pd.DataFrame, crypto_df: pd.DataFrame | None = None) -> pd.DataFrame:
        df = add_fair_value_features(df)
        df = compute_fair_probabilities(df)

        if crypto_df is not None and not crypto_df.empty:
            regime_df = classify_regimes(crypto_df)
        else:
            # Build minimal crypto frame from merged snapshots
            crypto_cols = ["asset", "timestamp", "spot_price", "realized_vol_1h",
                           "order_book_imbalance", "return_1m"]
            if "volume_24h" in df.columns:
                crypto_cols.append("volume_24h")
            elif "volume" in df.columns:
                df = df.copy()
                df["volume_24h"] = df["volume"]
                crypto_cols.append("volume_24h")
            avail = [c for c in crypto_cols if c in df.columns]
            regime_df = classify_regimes(df[avail].drop_duplicates(["asset", "timestamp"]))

        df = merge_regime_to_snapshots(df, regime_df)
        df = regime_adjusted_probability(df)

        # Add prob_change for momentum/mean-reversion
        df = df.sort_values(["market_id", "timestamp"])
        df["prob_change"] = df.groupby("market_id")["market_probability"].diff().fillna(0)
        return df

    def run_component(
        self,
        df: pd.DataFrame,
        component: str,
        min_edge: float = 0.02,
        split_name: str = "test",
    ) -> tuple[pd.DataFrame, dict[str, Any]]:
        """Run a single strategy component through portfolio simulation."""
        if component not in SIGNAL_GENERATORS:
            raise ValueError(f"Unknown component: {component}")

        signals = SIGNAL_GENERATORS[component](df, min_edge)
        trades, cb_report = self._simulate_portfolio(df, signals, component, min_edge)

        metrics = compute_metrics(trades, self.config.initial_capital)
        metrics["split"] = split_name
        metrics["component"] = component
        metrics["circuit_breaker"] = cb_report
        metrics["by_regime"] = metrics_by_group(trades, "regime", self.config.initial_capital) if not trades.empty and "regime" in trades.columns else {}
        metrics["by_asset"] = metrics_by_group(trades, "asset", self.config.initial_capital) if not trades.empty else {}
        return trades, metrics

    def _simulate_portfolio(
        self,
        df: pd.DataFrame,
        signals: list[TradeSignal],
        component: str,
        min_edge: float,
    ) -> tuple[pd.DataFrame, dict]:
        """Chronological portfolio simulation with exits and risk controls."""
        df_indexed = df.set_index(["market_id", "timestamp"])
        signal_map: dict[tuple, list[TradeSignal]] = {}
        for s in signals:
            key = (s.market_id, s.timestamp)
            signal_map.setdefault(key, []).append(s)

        exposure = ExposureState()
        cb = CircuitBreakerState(self.cb_config, self.config.initial_capital)
        open_positions: dict[str, OpenPosition] = {}
        closed_trades: list[dict] = []
        equity = self.config.initial_capital
        max_open_per_market = 1

        timeline = df.sort_values("timestamp")
        for row in timeline.itertuples(index=False):
            ts = row.timestamp
            trade_date = ts.date() if hasattr(ts, "date") else date.today()

            # --- Check exits on open positions ---
            to_close = []
            for pid, pos in open_positions.items():
                if pos.market_id != row.market_id:
                    continue
                try:
                    snap = df_indexed.loc[(row.market_id, ts)]
                    if isinstance(snap, pd.DataFrame):
                        snap = snap.iloc[0]
                except KeyError:
                    continue

                model_p = getattr(snap, "adjusted_probability", None) or getattr(snap, "model_probability", 0.5)
                exit_sig = check_exit(
                    pos,
                    current_yes_bid=snap.yes_bid,
                    current_yes_ask=snap.yes_ask,
                    current_no_bid=snap.no_bid,
                    current_no_ask=snap.no_ask,
                    model_probability=model_p,
                    current_regime=getattr(snap, "regime", "UNCERTAIN"),
                    time_remaining_seconds=snap.time_remaining_seconds,
                    min_edge=min_edge,
                    uncertainty_buffer=getattr(snap, "uncertainty_buffer", 0.01),
                )
                if exit_sig.should_exit or cb.triggered:
                    reason = ExitReason.CIRCUIT_BREAKER if cb.triggered else exit_sig.reason
                    exit_price = exit_sig.exit_price or pos.entry_price
                    settlement = snap.settlement_result
                    if pos.side == "YES":
                        pnl = pos.size_usd * (settlement - pos.entry_price) - pos.size_usd * self.config.exchange_fee_pct
                    else:
                        pnl = pos.size_usd * ((1 - settlement) - pos.entry_price) - pos.size_usd * self.config.exchange_fee_pct
                    closed_trades.append(self._trade_record(pos, pnl, reason, settlement, snap))
                    equity += pnl
                    cb.record_pnl(pnl, trade_date)
                    to_close.append(pid)

            for pid in to_close:
                exposure.remove(pid)
                del open_positions[pid]

            cb.update_equity(equity, trade_date)
            if not cb.can_trade():
                continue

            # --- Process entry signals ---
            key = (row.market_id, ts)
            expected_strategy = COMPONENT_STRATEGY_MAP.get(component)
            for sig in signal_map.get(key, []):
                if expected_strategy and sig.strategy != expected_strategy:
                    continue
                if sum(1 for p in open_positions.values() if p.market_id == row.market_id) >= max_open_per_market:
                    continue

                yes_ask = row.executable_yes
                no_ask = row.executable_no
                depth = row.yes_ask_depth if sig.side == "YES" else row.no_ask_depth
                liq_usd = depth * (yes_ask if sig.side == "YES" else no_ask)

                corr_exp = exposure.correlated_exposure(sig.asset, sig.side, equity)
                size = compute_position_size(
                    net_edge=sig.gross_edge,
                    min_edge=min_edge,
                    model_confidence=sig.confidence,
                    realized_vol=getattr(row, "realized_vol", 0.5) or 0.5,
                    available_liquidity_usd=liq_usd,
                    correlated_exposure_pct=corr_exp,
                    base_size_usd=100.0,
                    max_size_usd=500.0,
                )
                if size <= 0:
                    continue
                if not exposure.can_add(sig.asset, sig.side, size, equity):
                    continue

                exec_r = simulate_market_order(
                    side=sig.side,
                    size_usd=size,
                    yes_ask=yes_ask,
                    no_ask=no_ask,
                    yes_ask_depth=row.yes_ask_depth,
                    no_ask_depth=row.no_ask_depth,
                    fee_pct=self.config.exchange_fee_pct,
                    slippage_bps=self.config.slippage_bps,
                    min_liquidity=self.config.min_liquidity_usd,
                )
                if not exec_r.filled:
                    continue

                pid = str(uuid.uuid4())[:8]
                pos = OpenPosition(
                    position_id=pid,
                    market_id=sig.market_id,
                    asset=sig.asset,
                    side=sig.side,
                    entry_price=exec_r.fill_price,
                    size_usd=exec_r.fill_size_usd,
                    entry_timestamp=ts,
                    strategy=sig.strategy,
                    regime_at_entry=sig.regime,
                    model_probability=sig.model_probability,
                    time_remaining_seconds=row.time_remaining_seconds,
                )
                open_positions[pid] = pos
                exposure.add(pos)

        # Close remaining positions at settlement
        for pid, pos in list(open_positions.items()):
            market_snaps = df[df["market_id"] == pos.market_id]
            if market_snaps.empty:
                continue
            last = market_snaps.iloc[-1]
            settlement = last.settlement_result
            if pos.side == "YES":
                pnl = pos.size_usd * (settlement - pos.entry_price) - pos.size_usd * self.config.exchange_fee_pct
            else:
                pnl = pos.size_usd * ((1 - settlement) - pos.entry_price) - pos.size_usd * self.config.exchange_fee_pct
            closed_trades.append(self._trade_record(pos, pnl, "settlement", settlement, last))
            equity += pnl

        trades_df = pd.DataFrame(closed_trades) if closed_trades else pd.DataFrame()
        return trades_df, cb.diagnostic_report()

    def _trade_record(self, pos, pnl, reason, settlement, snap) -> dict:
        return {
            "market_id": pos.market_id,
            "asset": pos.asset,
            "timestamp": pos.entry_timestamp,
            "side": pos.side,
            "entry_price": pos.entry_price,
            "exit_price": float(settlement) if pos.side == "YES" else float(1 - settlement),
            "size_usd": pos.size_usd,
            "gross_edge": 0.0,
            "realized_edge": (settlement - pos.entry_price) if pos.side == "YES" else ((1 - settlement) - pos.entry_price),
            "fees": pos.size_usd * self.config.exchange_fee_pct,
            "slippage": 0.0,
            "pnl": pnl,
            "settlement_result": settlement,
            "time_remaining_seconds": pos.time_remaining_seconds,
            "strategy": pos.strategy,
            "regime": pos.regime_at_entry,
            "exit_reason": str(reason),
        }

    def compare_components(self, df: pd.DataFrame, split_name: str = "test") -> dict[str, Any]:
        """Backtest all components separately on identical data with same cost assumptions."""
        if "regime" not in df.columns:
            prepared = self.prepare_data(df)
        else:
            prepared = df
        min_edge = self.config.raw.get("regime", {}).get("min_edge", 0.02)
        results = {}
        all_trades = {}
        for component in SIGNAL_GENERATORS:
            trades, metrics = self.run_component(prepared, component, min_edge, split_name)
            results[component] = metrics
            all_trades[component] = trades
        return {"components": results, "trades": all_trades, "min_edge": min_edge}
