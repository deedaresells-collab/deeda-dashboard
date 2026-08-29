"""Core backtesting engine with chronological splits and walk-forward."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from pmresearch.backtests.metrics import break_even_edge, compute_metrics, metrics_by_group
from pmresearch.config import Config
from pmresearch.data.loader import chronological_split
from pmresearch.features.market_features import add_fair_value_features
from pmresearch.models.fair_value import compute_fair_probabilities
from pmresearch.strategies.fair_value_mispricing import generate_signals_a
from pmresearch.strategies.latency_momentum import compute_latency_signals
from pmresearch.strategies.passive_mm import generate_mm_trades


class BacktestEngine:
    def __init__(self, config: Config):
        self.config = config

    def prepare_data(self, df: pd.DataFrame) -> pd.DataFrame:
        df = add_fair_value_features(df)
        df = compute_fair_probabilities(df)
        return df

    def run_strategy_a(
        self,
        df: pd.DataFrame,
        minimum_edge: float,
        position_size: float,
        split_name: str = "full",
    ) -> tuple[pd.DataFrame, dict[str, Any]]:
        trades = generate_signals_a(
            df,
            minimum_edge=minimum_edge,
            position_size_usd=position_size,
            fee_pct=self.config.exchange_fee_pct,
            slippage_bps=self.config.slippage_bps,
            min_liquidity=self.config.min_liquidity_usd,
        )
        metrics = compute_metrics(trades, self.config.initial_capital)
        metrics["break_even_edge"] = break_even_edge(trades)
        metrics["split"] = split_name
        metrics["parameter"] = f"min_edge={minimum_edge:.3f}"
        metrics["by_asset"] = metrics_by_group(trades, "asset", self.config.initial_capital)
        metrics["by_duration"] = metrics_by_group(trades, "duration_minutes", self.config.initial_capital)
        return trades, metrics

    def run_strategy_b(
        self,
        df: pd.DataFrame,
        lag_ms: int,
        position_size: float = 100.0,
        split_name: str = "full",
    ) -> tuple[pd.DataFrame, dict[str, Any]]:
        trades = compute_latency_signals(df, lag_ms=lag_ms, position_size_usd=position_size)
        metrics = compute_metrics(trades, self.config.initial_capital)
        metrics["split"] = split_name
        metrics["parameter"] = f"lag_ms={lag_ms}"
        return trades, metrics

    def run_strategy_c(
        self,
        df: pd.DataFrame,
        spread: float,
        position_size: float = 100.0,
        split_name: str = "full",
    ) -> tuple[pd.DataFrame, dict[str, Any]]:
        trades = generate_mm_trades(
            df, spread=spread, position_size_usd=position_size, fee_pct=self.config.exchange_fee_pct
        )
        metrics = compute_metrics(trades, self.config.initial_capital)
        metrics["split"] = split_name
        metrics["parameter"] = f"spread={spread:.3f}"
        return trades, metrics

    def run_full_backtest(self, df: pd.DataFrame) -> dict[str, Any]:
        df = self.prepare_data(df)
        train, val, test = chronological_split(
            df,
            train_pct=self.config.train_pct,
            val_pct=self.config.validation_pct,
        )

        results: dict[str, Any] = {
            "run_id": str(uuid.uuid4()),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "splits": {"train": len(train), "validation": len(val), "test": len(test)},
            "strategies": {},
        }

        # Strategy A across thresholds on validation, report test
        best_a_val = None
        best_a_param = None
        for threshold in self.config.strategy_a_thresholds:
            _, val_metrics = self.run_strategy_a(val, threshold, 100.0, "validation")
            if best_a_val is None or val_metrics["net_profit"] > best_a_val["net_profit"]:
                best_a_val = val_metrics
                best_a_param = threshold

        test_trades_a, test_metrics_a = self.run_strategy_a(test, best_a_param, 100.0, "test")
        train_trades_a, train_metrics_a = self.run_strategy_a(train, best_a_param, 100.0, "train")
        results["strategies"]["A_fair_value"] = {
            "selected_parameter": best_a_param,
            "train": train_metrics_a,
            "validation": best_a_val,
            "test": test_metrics_a,
            "all_thresholds_validation": {},
        }
        for threshold in self.config.strategy_a_thresholds:
            _, m = self.run_strategy_a(val, threshold, 100.0, "validation")
            results["strategies"]["A_fair_value"]["all_thresholds_validation"][str(threshold)] = m

        # Strategy B
        best_b_val = None
        best_b_param = None
        for lag in self.config.strategy_b_lags_ms:
            _, val_metrics = self.run_strategy_b(val, lag, 100.0, "validation")
            if best_b_val is None or val_metrics["net_profit"] > best_b_val["net_profit"]:
                best_b_val = val_metrics
                best_b_param = lag
        _, test_metrics_b = self.run_strategy_b(test, best_b_param, 100.0, "test")
        results["strategies"]["B_latency"] = {
            "selected_parameter": best_b_param,
            "validation": best_b_val,
            "test": test_metrics_b,
        }

        # Strategy C
        best_c_val = None
        best_c_param = None
        for spread in self.config.strategy_c_spreads:
            _, val_metrics = self.run_strategy_c(val, spread, 100.0, "validation")
            if best_c_val is None or val_metrics["net_profit"] > best_c_val["net_profit"]:
                best_c_val = val_metrics
                best_c_param = spread
        _, test_metrics_c = self.run_strategy_c(test, best_c_param, 100.0, "test")
        results["strategies"]["C_passive_mm"] = {
            "selected_parameter": best_c_param,
            "validation": best_c_val,
            "test": test_metrics_c,
        }

        # Walk-forward
        results["walk_forward"] = self._walk_forward(df)

        # Scalability
        results["scalability"] = self._scalability_test(test, best_a_param)

        results["completed_at"] = datetime.now(timezone.utc).isoformat()
        results["test_trades_a"] = test_trades_a
        return results

    def _walk_forward(self, df: pd.DataFrame, n_folds: int = 3) -> list[dict]:
        df = df.sort_values("timestamp").reset_index(drop=True)
        fold_size = len(df) // (n_folds + 1)
        folds = []
        for i in range(n_folds):
            train_end = fold_size * (i + 1)
            test_end = min(train_end + fold_size, len(df))
            train_fold = df.iloc[:train_end]
            test_fold = df.iloc[train_end:test_end]
            if test_fold.empty:
                continue
            _, metrics = self.run_strategy_a(test_fold, 0.03, 100.0, f"wf_{i}")
            folds.append({"fold": i, "train_size": len(train_fold), "test_size": len(test_fold), "metrics": metrics})
        return folds

    def _scalability_test(self, df: pd.DataFrame, min_edge: float) -> dict[str, dict]:
        results = {}
        for size in self.config.position_sizes_usd:
            _, metrics = self.run_strategy_a(df, min_edge, size, "scalability")
            results[str(size)] = metrics
        return results
