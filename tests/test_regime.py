"""Tests for market regime engine."""

from __future__ import annotations

import pytest

from pmresearch.backtests.regime_engine import RegimeBacktestRunner, SIGNAL_GENERATORS
from pmresearch.config import Config
from pmresearch.data.loader import chronological_split, load_merged_snapshots
from pmresearch.features.regime import Regime, classify_regimes, compute_regime_features, merge_regime_to_snapshots


def _crypto_from_merged(df):
  cols = ["asset", "timestamp", "spot_price", "realized_vol_1h", "order_book_imbalance", "return_1m"]
  if "volume" in df.columns:
      tmp = df[cols + ["volume"]].drop_duplicates(["asset", "timestamp"]).copy()
      tmp["volume_24h"] = tmp["volume"]
      return tmp.drop(columns=["volume"])
  return df[cols].drop_duplicates(["asset", "timestamp"])


def test_regime_features_no_lookahead(temp_db):
    df = load_merged_snapshots(temp_db)
    crypto = _crypto_from_merged(df)
    featured = compute_regime_features(crypto)
    assert "return_zscore" in featured.columns
    assert "dist_from_ma" in featured.columns
    assert featured["return_zscore"].notna().sum() > 0


def test_regime_classification_values(temp_db):
    df = load_merged_snapshots(temp_db)
    crypto = _crypto_from_merged(df)
    classified = classify_regimes(crypto)
    valid = {r.value for r in Regime}
    assert set(classified["regime"].unique()).issubset(valid)


def test_regime_merge_no_lookahead(temp_db):
    df = load_merged_snapshots(temp_db)
    crypto = _crypto_from_merged(df)
    regime_df = classify_regimes(crypto)
    merged = merge_regime_to_snapshots(df, regime_df)
    assert "regime" in merged.columns
    assert merged["regime"].notna().all()


def test_all_components_exist():
    expected = {"fair_value_only", "mean_reversion_only", "momentum_only", "order_flow_only", "regime_switching"}
    assert set(SIGNAL_GENERATORS.keys()) == expected


def test_regime_backtest_runs_on_test_split(temp_db):
    df = load_merged_snapshots(temp_db)
    cfg = Config()
    runner = RegimeBacktestRunner(cfg)
    prepared = runner.prepare_data(df)
    _, _, test = chronological_split(prepared)
    results = runner.compare_components(test, split_name="test")
    assert "components" in results
    for component in SIGNAL_GENERATORS:
        assert component in results["components"]
        assert "num_trades" in results["components"][component]


def test_circuit_breaker_config():
    cfg = Config()
    runner = RegimeBacktestRunner(cfg)
    assert runner.cb_config.max_portfolio_drawdown_pct > 0
