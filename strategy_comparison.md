# Strategy Comparison Report

Generated: 2026-08-29T01:18:48.233911+00:00
Data type: **SYNTHETIC_DEMO**
Split: test (58979 observations)

> **WARNING:** Synthetic demo data is for pipeline validation only. Results are NOT evidence of real profitability.

## Strategy Comparison (Out-of-Sample)

| Strategy | Trades | Net P&L | Win Rate | Sharpe | Max DD | PF | Pred Edge | Real Edge |
|----------|--------|---------|----------|--------|--------|-----|-----------|-----------|
| FAIR_VALUE | 115 | $-501.63 | 78.3% | -1.785 | -5.19% | 0.68 | 0.0333 | -0.0645 |
| MEAN_REVERSION | 34 | $-482.60 | 79.4% | -4.943 | -5.74% | 0.29 | 0.0366 | -0.1370 |
| MOMENTUM | 0 | $0.00 | 0.0% | 0.000 | 0.00% | 0.00 | 0.0000 | 0.0000 |
| ORDER_FLOW | 0 | $0.00 | 0.0% | 0.000 | 0.00% | 0.00 | 0.0000 | 0.0000 |
| REGIME_SWITCH | 55 | $-557.99 | 76.4% | -3.973 | -5.71% | 0.44 | 0.0410 | -0.1073 |

## Regime Analysis

### FAIR_VALUE
| Regime | Trades | Net P&L | Win Rate | Pred Edge | Real Edge |
|--------|--------|---------|----------|-----------|-----------|
| MEAN_REVERTING | 10 | $-183.67 | 80.0% | 0.0321 | -0.1524 |
| MOMENTUM_TRENDING | 17 | $139.39 | 82.4% | 0.0352 | 0.0210 |
| UNCERTAIN | 88 | $-457.35 | 77.3% | 0.0331 | -0.0710 |

### MEAN_REVERSION
| Regime | Trades | Net P&L | Win Rate | Pred Edge | Real Edge |
|--------|--------|---------|----------|-----------|-----------|
| MEAN_REVERTING | 34 | $-482.60 | 79.4% | 0.0366 | -0.1370 |

### REGIME_SWITCH
| Regime | Trades | Net P&L | Win Rate | Pred Edge | Real Edge |
|--------|--------|---------|----------|-----------|-----------|
| MEAN_REVERTING | 2 | $-107.19 | 50.0% | 0.0300 | -0.4545 |
| UNCERTAIN | 53 | $-450.81 | 77.4% | 0.0414 | -0.0942 |


## Edge Bucket Analysis

### FAIR_VALUE
| Bucket | Trades | Expected | Realized | Profit |
|--------|--------|----------|----------|--------|
| 0.0%-1.0% | 0 | nan | nan | $0.00 |
| 1.0%-2.0% | 0 | nan | nan | $0.00 |
| 2.0%-3.0% | 58 | 0.0248 | -0.0547 ⚠️ | $-239.08 |
| 3.0%-4.0% | 27 | 0.0340 | 0.0308 | $167.11 |
| 4.0%-5.0% | 16 | 0.0428 | -0.1608 ⚠️ | $-238.85 |
| 5.0%-7.5% | 13 | 0.0546 | -0.1992 ⚠️ | $-198.22 |
| 7.5%-10.0% | 1 | 0.0767 | 0.0922 | $7.40 |
| 10.0%+ | 0 | nan | nan | $0.00 |

### MEAN_REVERSION
| Bucket | Trades | Expected | Realized | Profit |
|--------|--------|----------|----------|--------|
| 0.0%-1.0% | 0 | nan | nan | $0.00 |
| 1.0%-2.0% | 0 | nan | nan | $0.00 |
| 2.0%-3.0% | 15 | 0.0244 | -0.2265 ⚠️ | $-332.09 |
| 3.0%-4.0% | 6 | 0.0346 | 0.0500 | $46.03 |
| 4.0%-5.0% | 6 | 0.0441 | -0.1789 ⚠️ | $-184.02 |
| 5.0%-7.5% | 7 | 0.0579 | -0.0695 ⚠️ | $-12.52 |
| 7.5%-10.0% | 0 | nan | nan | $0.00 |
| 10.0%+ | 0 | nan | nan | $0.00 |

### REGIME_SWITCH
| Bucket | Trades | Expected | Realized | Profit |
|--------|--------|----------|----------|--------|
| 0.0%-1.0% | 0 | nan | nan | $0.00 |
| 1.0%-2.0% | 0 | nan | nan | $0.00 |
| 2.0%-3.0% | 1 | 0.0265 | -0.9580 ⚠️ | $-114.41 |
| 3.0%-4.0% | 28 | 0.0343 | -0.0397 ⚠️ | $-102.13 |
| 4.0%-5.0% | 15 | 0.0434 | -0.1079 ⚠️ | $-140.66 |
| 5.0%-7.5% | 10 | 0.0539 | -0.2306 ⚠️ | $-208.99 |
| 7.5%-10.0% | 1 | 0.0767 | 0.0922 | $8.20 |
| 10.0%+ | 0 | nan | nan | $0.00 |

## Evidence Assessment

**No evidence of real edge.** Synthetic data validates pipeline only.