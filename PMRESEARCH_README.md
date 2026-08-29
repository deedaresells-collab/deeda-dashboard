# Prediction Market Research Platform

Quantitative research and backtesting for short-duration BTC/ETH prediction markets.

## Architecture

```
pmresearch/
├── collectors/       # Data ingestion (exchanges, demo data)
├── data/             # DuckDB storage and loading
├── features/         # Feature engineering
├── regimes/          # Market regime classification
├── models/           # Fair value probability models
├── strategies/       # Independent strategy modules
│   ├── fair_value.py
│   ├── mean_reversion.py
│   ├── momentum.py
│   ├── order_flow.py
│   └── regime_switch.py
├── risk/             # Position sizing, exposure, circuit breakers, exits
├── backtests/        # Backtest engines
├── execution/        # Fill/cost simulation
└── reports/          # Comparison and analysis reports
```

## Quick Start

```bash
pip install -r requirements.txt

# Generate synthetic demo data (pipeline validation ONLY)
python3 run_backtest.py generate-demo --days 14

# Run all 5 strategies through common engine on OOS test data
python3 run_backtest.py compare-strategies

# Legacy baseline backtest (Strategies A/B/C)
python3 run_backtest.py backtest

# Run tests
pytest tests/ -v
```

## Strategies

All strategies run through the **same execution engine** with identical fees, slippage, and liquidity constraints.

| Strategy | Module | Regime Filter |
|----------|--------|---------------|
| FAIR_VALUE | `strategies/fair_value.py` | None |
| MEAN_REVERSION | `strategies/mean_reversion.py` | MEAN_REVERTING |
| MOMENTUM | `strategies/momentum.py` | MOMENTUM_TRENDING |
| ORDER_FLOW | `strategies/order_flow.py` | None |
| REGIME_SWITCH | `strategies/regime_switch.py` | Routes by regime |

## Regime Classification

`pmresearch/regimes/classifier.py` classifies each timestamp as:
- **MEAN_REVERTING** — extreme z-scores, low persistence
- **MOMENTUM_TRENDING** — breakouts, volume, persistence
- **UNCERTAIN** — mixed signals

All thresholds configurable in `config.yaml` under `regime:`.

## Risk Management

`pmresearch/risk/` provides:
- Position sizing: `FIXED_SIZE`, `FIXED_FRACTION`, `EDGE_WEIGHTED`
- Correlated exposure limits (BTC/ETH/SOL)
- Circuit breakers: daily loss, max drawdown, consecutive losses
- Thesis-based exits (edge decay, regime change, liquidity, settlement)

## Outputs

| File | Description |
|------|-------------|
| `reports/output/strategy_comparison.json` | Full comparison metrics |
| `strategy_comparison.md` | Human-readable comparison report |
| `research_log.md` | Experiment log |

## Important

**Synthetic demo data validates the pipeline only. It is NOT evidence of a real trading edge.**

Do not optimize parameters against synthetic data or the final test set.

## Configuration

See `config.yaml` for:
- `regime:` — classifier thresholds, min edge
- `risk:` — position sizing, exposure limits, circuit breakers
- `backtest:` — train/val/test splits, fees, slippage
