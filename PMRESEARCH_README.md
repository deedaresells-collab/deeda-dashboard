# Prediction Market Research Platform

Quantitative research and backtesting platform for short-duration BTC/ETH prediction markets.

## Architecture

```
pmresearch/
├── collectors/     # Data ingestion (exchanges, demo data)
├── data/           # Storage (DuckDB) and loading
├── features/       # Feature engineering
├── models/         # Fair value probability model
├── strategies/     # Strategies A, B, C
├── backtests/      # Backtest engine, metrics, research loop
├── execution/      # Cost and fill modeling
└── reports/        # Calibration, Monte Carlo, summaries
```

## Quick Start

```bash
pip install -r requirements.txt

# Generate synthetic demo data and run baseline backtest
python run_backtest.py generate-demo --days 30
python run_backtest.py backtest

# Run tests
pytest tests/ -v
```

## Important

- **Synthetic demo data** is for pipeline validation only — not evidence of real edge.
- Import real historical prediction-market order book data for production research.
- Never use look-ahead data in backtests.

## Data Requirements

Prediction market snapshots: market ID, YES/NO bid/ask, depth, timestamps, settlement.
Crypto snapshots: spot, bid/ask, returns, vol, order book imbalance.

### Regime Engine

```bash
python3 run_backtest.py backtest-regime
```

Compares five strategy components on out-of-sample data:
- `fair_value_only` — baseline fair value
- `mean_reversion_only` — fade probability overshoots in MEAN_REVERTING regime
- `momentum_only` — trade breakouts in MOMENTUM_TRENDING regime
- `order_flow_only` — OB imbalance signals
- `regime_switching` — routes by regime

Output: `regime_results_summary.md`

- `results_summary.md` — final research summary
- `research_log.md` — experiment log
- `reports/output/` — JSON results, calibration charts, trade logs
