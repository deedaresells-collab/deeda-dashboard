# Regime Engine Results

Generated: 2026-08-29T01:08:12.229512+00:00
Min edge threshold: 2.0%

## Component Comparison (Out-of-Sample)

| Component | Trades | Net P&L | Win Rate | Sharpe | Max DD | PF | Realized Edge | CB Triggered |
|-----------|--------|---------|----------|--------|--------|-----|---------------|--------------|
| mean_reversion_only | 526 | $6,230.22 | 18.8% | 5.300 | -1.58% | 4.60 | 0.1414 | False |
| order_flow_only | 508 | $3,902.31 | 32.9% | 6.443 | -0.97% | 3.75 | 0.1978 | False |
| regime_switching | 1072 | $2,979.38 | 44.9% | 1.453 | -3.51% | 1.38 | 0.0231 | False |
| fair_value_only | 149 | $-479.15 | 77.2% | -1.159 | -8.40% | 0.79 | -0.0391 | True |
| momentum_only | 37 | $-829.19 | 32.4% | -4.752 | -8.50% | 0.50 | -0.1052 | True |

## Interpretation

This comparison tests which approach — if any — shows statistical merit under different
market regimes. **No component is assumed profitable.**

### Regime Distribution

Components are active only in their designated regimes:
- **mean_reversion_only**: MEAN_REVERTING
- **momentum_only**: MOMENTUM_TRENDING
- **fair_value_only**: all regimes (baseline)
- **order_flow_only**: all regimes (OB imbalance)
- **regime_switching**: routes by regime

### Best OOS Component (by net P&L)

**mean_reversion_only** — $6,230.22 net, 526 trades, Sharpe 5.300

## Evidence Assessment

**INCONCLUSIVE — synthetic demo data.** Components show varying OOS results but these cannot support claims of a real edge. Import real historical data before drawing conclusions.

## Risk Controls Applied

- Adaptive position sizing (edge, confidence, vol, liquidity, correlation)
- Correlated exposure limits across BTC/ETH/SOL
- Per-position risk limits
- Daily loss limit
- Portfolio drawdown circuit breaker (halts new trades, closes positions)
