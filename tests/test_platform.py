"""Tests for the prediction-market research platform."""

from __future__ import annotations

import pandas as pd

from pmresearch.backtests.engine import BacktestEngine
from pmresearch.backtests.metrics import compute_metrics
from pmresearch.config import Config, load_config
from pmresearch.data.loader import chronological_split, load_merged_snapshots
from pmresearch.execution.costs import simulate_market_order
from pmresearch.features.market_features import add_fair_value_features
from pmresearch.models.fair_value import compute_fair_probabilities, fair_probability_row
from pmresearch.reports.calibration import calibration_table, edge_bucket_analysis


def test_config_loads():
    cfg = load_config()
    assert "BTC" in cfg.assets
    assert cfg.train_pct == 0.60


def test_fair_probability_bounds():
    p = fair_probability_row(100000, 100000, 300, 0.5)
    assert 0.001 <= p <= 0.999


def test_chronological_split_order():
    df = pd.DataFrame({"timestamp": pd.date_range("2025-01-01", periods=100, freq="h"), "value": range(100)})
    train, val, test = chronological_split(df)
    assert len(train) == 60
    assert len(val) == 20
    assert len(test) == 20
    assert train["timestamp"].max() < val["timestamp"].min()
    assert val["timestamp"].max() < test["timestamp"].min()


def test_no_lookahead_crypto_merge(temp_db):
    df = load_merged_snapshots(temp_db)
    assert not df.empty
    assert (df["crypto_lag_seconds"] >= 0).all()


def test_execution_uses_ask_not_midpoint():
    result = simulate_market_order("YES", 100, 0.55, 0.50, 1000, 1000, 0.001, 5)
    assert result.filled
    assert result.fill_price >= 0.55


def test_backtest_runs_end_to_end(temp_db):
    df = load_merged_snapshots(temp_db)
    cfg = Config()
    engine = BacktestEngine(cfg)
    results = engine.run_full_backtest(df)
    assert "strategies" in results
    assert "A_fair_value" in results["strategies"]
    test_metrics = results["strategies"]["A_fair_value"]["test"]
    assert "num_trades" in test_metrics


def test_calibration_table(temp_db):
    df = load_merged_snapshots(temp_db)
    df = add_fair_value_features(df)
    df = compute_fair_probabilities(df)
    cal = calibration_table(df.groupby("market_id").last().reset_index())
    assert len(cal) == 10


def test_edge_buckets():
    trades = pd.DataFrame({
        "gross_edge": [0.005, 0.015, 0.025, 0.05, 0.08],
        "realized_edge": [0.001, 0.01, 0.02, 0.03, 0.05],
        "pnl": [1, 2, 3, 5, 8],
        "size_usd": [100, 100, 100, 100, 100],
    })
    buckets = edge_bucket_analysis(trades)
    assert len(buckets) == 8


def test_metrics_empty():
    m = compute_metrics(pd.DataFrame())
    assert m["num_trades"] == 0
