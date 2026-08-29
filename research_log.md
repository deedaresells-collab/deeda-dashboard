# Research Log

Platform baseline implementation. All experiments logged below.

## Baseline — 2025-01-01

- **Status:** Initial implementation
- **Fair value model:** Black-Scholes digital approximation + momentum/OB imbalance adjustments
- **Strategies:** A (fair value mispricing), B (latency/momentum), C (passive MM)
- **Data:** Synthetic demo data for pipeline validation (NOT real market data)
## Baseline Backtest Run — 2026-08-29

- **Data:** 27254 synthetic markets, 294894 snapshots (14 days, BTC+ETH, 5/15/60min)
- **Strategy A (test):** 2 trades, -$29.51 net, min_edge=10% selected on validation
- **Strategy B (test):** 14761 trades, +$216k net (likely inflated — synthetic lag + no liquidity gates)
- **Strategy C (test):** 5889 trades, +$3543 net
- **Verdict:** Pipeline works end-to-end; synthetic data cannot support real edge claims
- **Next:** Import real prediction-market order book data; fix Strategy B overtrading
