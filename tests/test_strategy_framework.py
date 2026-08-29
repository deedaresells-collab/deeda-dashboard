"""Tests for strategy framework, risk, and regime modules."""

from __future__ import annotations

import pandas as pd
import pytest

from pmresearch.backtests.strategy_engine import STRATEGIES, StrategyBacktestEngine
from pmresearch.config import Config
from pmresearch.data.loader import chronological_split, load_merged_snapshots
from pmresearch.models.fair_value import compute_baseline_probabilities, fair_probability_row
from pmresearch.regimes.classifier import Regime, RegimeConfig, classify_regimes, merge_regime_to_snapshots
from pmresearch.risk.circuit_breaker import CircuitBreakerConfig, CircuitBreakerState
from pmresearch.risk.exposure import ExposureState, RiskLimits
from pmresearch.risk.exits import ExitReason, check_exit
from pmresearch.risk.position_sizing import PositionSizingMethod, compute_position_size
from pmresearch.strategies.fair_value import generate_signals as fv_signals
from pmresearch.strategies.mean_reversion import generate_signals as mr_signals
from pmresearch.strategies.regime_switch import generate_signals as rs_signals


def test_fair_probability_bounds():
    p = fair_probability_row(100000, 100000, 300, 0.5)
    assert 0.001 <= p <= 0.999


def test_baseline_probability_column(temp_db):
    df = load_merged_snapshots(temp_db)
    from pmresearch.features.market_features import add_fair_value_features
    df = add_fair_value_features(df)
    df = compute_baseline_probabilities(df)
    assert "baseline_probability_yes" in df.columns
    assert df["baseline_probability_yes"].between(0.001, 0.999).all()


def test_regime_no_lookahead(temp_db):
    df = load_merged_snapshots(temp_db)
    crypto = df[["asset", "timestamp", "spot_price", "realized_vol_1h", "order_book_imbalance", "return_1m"]].drop_duplicates(["asset", "timestamp"])
    classified = classify_regimes(crypto, RegimeConfig())
    merged = merge_regime_to_snapshots(df.head(1000), classified)
    assert "regime" in merged.columns
    assert merged["regime"].notna().all()


def test_position_sizing_methods():
    for method in PositionSizingMethod:
        size = compute_position_size(
            method=method, net_edge=0.05, min_edge=0.02, model_confidence=0.8,
            realized_vol=0.5, available_liquidity_usd=5000, correlated_exposure_pct=0.1,
            portfolio_value=10000,
        )
        assert size >= 0


def test_correlated_exposure_limit():
    exp = ExposureState(limits=RiskLimits(max_asset_exposure_pct=0.10))
    assert not exp.can_add("BTC", "YES", 2000, 10000)
    assert exp.can_add("BTC", "YES", 500, 10000)


def test_daily_loss_circuit_breaker():
    cb = CircuitBreakerState(CircuitBreakerConfig(daily_loss_limit_pct=0.05), 10000)
    import datetime
    d = datetime.date(2025, 1, 1)
    cb.record_trade(-600, d)
    cb.update_equity(9400, d)
    assert cb.triggered


def test_max_drawdown_circuit_breaker():
    cb = CircuitBreakerState(CircuitBreakerConfig(max_portfolio_drawdown_pct=0.10), 10000)
    import datetime
    d = datetime.date(2025, 1, 1)
    cb.update_equity(8500, d)
    assert cb.triggered


def test_exit_reasons_recorded(temp_db):
    from pmresearch.risk.exposure import OpenPosition
    pos = OpenPosition(
        position_id="1", market_id="m1", asset="BTC", side="YES",
        entry_price=0.55, size_usd=100, entry_timestamp=pd.Timestamp("2025-01-01"),
        strategy="mean_reversion", regime_at_entry="MEAN_REVERTING",
        model_probability=0.6, time_remaining_seconds=300,
    )
    sig = check_exit(pos, 0.58, 0.56, 0.44, 0.46, 0.62, "MOMENTUM_TRENDING", 300, 0.02)
    assert sig.should_exit
    assert sig.reason == ExitReason.REGIME_INVALIDATED


def test_all_strategies_defined():
    assert set(STRATEGIES.keys()) == {"FAIR_VALUE", "MEAN_REVERSION", "MOMENTUM", "ORDER_FLOW", "REGIME_SWITCH"}


def test_strategy_routing(temp_db):
    df = load_merged_snapshots(temp_db)
    engine = StrategyBacktestEngine(Config())
    prepared = engine.prepare_data(df)
    _, _, test = chronological_split(prepared)
    results = engine.compare_all(test.head(5000))
    for name in STRATEGIES:
        assert name in results["strategies"]


def test_mean_reversion_requires_regime(temp_db):
    df = load_merged_snapshots(temp_db)
    engine = StrategyBacktestEngine(Config())
    prepared = engine.prepare_data(df)
    signals = mr_signals(prepared)
    for s in signals:
        assert s.strategy == "mean_reversion"


def test_regime_switch_uncertain_mode(temp_db):
    df = load_merged_snapshots(temp_db)
    engine = StrategyBacktestEngine(Config())
    prepared = engine.prepare_data(df)
    no_trade = rs_signals(prepared.head(1000), uncertain_mode="no_trade")
    with_fv = rs_signals(prepared.head(1000), uncertain_mode="fair_value")
    assert len(with_fv) >= len(no_trade)
