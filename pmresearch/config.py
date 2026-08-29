"""Configuration loader for the research platform."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = ROOT / "config.yaml"


@dataclass
class Config:
    assets: list[str] = field(default_factory=lambda: ["BTC", "ETH"])
    durations_minutes: list[int] = field(default_factory=lambda: [5, 15, 60])
    exchanges: list[str] = field(default_factory=lambda: ["coinbase", "binance", "kraken"])
    database_path: Path = field(default_factory=lambda: ROOT / "data" / "market_research.duckdb")
    train_pct: float = 0.60
    validation_pct: float = 0.20
    test_pct: float = 0.20
    initial_capital: float = 10000.0
    exchange_fee_pct: float = 0.001
    slippage_bps: float = 5.0
    min_liquidity_usd: float = 50.0
    strategy_a_thresholds: list[float] = field(
        default_factory=lambda: [0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.10]
    )
    strategy_b_lags_ms: list[int] = field(
        default_factory=lambda: [250, 500, 1000, 2000, 3000, 5000, 10000, 30000]
    )
    strategy_c_spreads: list[float] = field(
        default_factory=lambda: [0.01, 0.02, 0.03, 0.04, 0.05]
    )
    position_sizes_usd: list[float] = field(
        default_factory=lambda: [10, 25, 50, 100, 250, 500, 1000, 2500]
    )
    monte_carlo_simulations: int = 10000
    calibration_buckets: list[list[float]] = field(default_factory=list)
    edge_buckets: list[list[float]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


def load_config(path: Path | None = None) -> Config:
    cfg_path = path or DEFAULT_CONFIG_PATH
    with cfg_path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    db_path = ROOT / raw.get("database", {}).get("path", "data/market_research.duckdb")
    bt = raw.get("backtest", {})
    mc = raw.get("monte_carlo", {})

    return Config(
        assets=raw.get("assets", ["BTC", "ETH"]),
        durations_minutes=raw.get("durations_minutes", [5, 15, 60]),
        exchanges=raw.get("exchanges", ["coinbase", "binance", "kraken"]),
        database_path=db_path,
        train_pct=bt.get("train_pct", 0.60),
        validation_pct=bt.get("validation_pct", 0.20),
        test_pct=bt.get("test_pct", 0.20),
        initial_capital=bt.get("initial_capital", 10000.0),
        exchange_fee_pct=bt.get("exchange_fee_pct", 0.001),
        slippage_bps=bt.get("slippage_bps", 5.0),
        min_liquidity_usd=bt.get("min_liquidity_usd", 50.0),
        strategy_a_thresholds=raw.get("strategy_a", {}).get(
            "minimum_edge_thresholds", [0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.10]
        ),
        strategy_b_lags_ms=raw.get("strategy_b", {}).get(
            "lags_ms", [250, 500, 1000, 2000, 3000, 5000, 10000, 30000]
        ),
        strategy_c_spreads=raw.get("strategy_c", {}).get(
            "spreads_cents", [0.01, 0.02, 0.03, 0.04, 0.05]
        ),
        position_sizes_usd=raw.get("position_sizes_usd", [10, 25, 50, 100, 250, 500, 1000, 2500]),
        monte_carlo_simulations=mc.get("simulations", 10000),
        calibration_buckets=raw.get("calibration_buckets", []),
        edge_buckets=raw.get("edge_buckets", []),
        raw=raw,
    )
