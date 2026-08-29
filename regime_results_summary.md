# Regime Engine Results

Generated: 2026-08-29T01:05:33.663793+00:00
Min edge threshold: 2.0%

## Component Comparison (Out-of-Sample)

| Component | Trades | Net P&L | Win Rate | Sharpe | Max DD | PF | Realized Edge | CB Triggered |
|-----------|--------|---------|----------|--------|--------|-----|---------------|--------------|
| mean_reversion_only | 527 | $6,438.31 | 19.2% | 5.390 | -1.59% | 4.71 | 0.1450 | False |
| order_flow_only | 508 | $3,902.31 | 32.9% | 6.443 | -0.97% | 3.75 | 0.1978 | False |
| regime_switching | 1089 | $3,874.71 | 45.5% | 1.838 | -3.76% | 1.51 | 0.0294 | False |
| momentum_only | 37 | $320.01 | 48.6% | 1.653 | -2.73% | 1.28 | 0.0485 | False |
| fair_value_only | 145 | $-495.18 | 76.6% | -1.218 | -7.72% | 0.78 | -0.0448 | True |

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

**mean_reversion_only** — $6,438.31 net, 527 trades, Sharpe 5.390

## Evidence Assessment

**order_flow_only** shows positive OOS P&L with 508 trades and Sharpe 6.443. Requires validation on real data before any capital allocation.

## Risk Controls Applied

- Adaptive position sizing (edge, confidence, vol, liquidity, correlation)
- Correlated exposure limits across BTC/ETH/SOL
- Per-position risk limits
- Daily loss limit
- Portfolio drawdown circuit breaker (halts new trades, closes positions)
