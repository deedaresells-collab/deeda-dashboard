# Results Summary

Generated: 2026-08-29T00:57:43.395010+00:00

**Data type:** SYNTHETIC_DEMO

## Best Strategy

**Strategy A — Fair Value Mispricing**
- Selected parameter: min_edge = 0.1

## Out-of-Sample (Test) Results

| Metric | Value |
|--------|-------|
| Trade count | 2 |
| Net profit | $-29.51 |
| ROI | -14.76% |
| Max drawdown | 0.00% |
| Sharpe ratio | -6.692 |
| Profit factor | 0.253 |
| Average gross edge | 0.1003 |
| Realized edge | -0.1466 |
| Break-even edge | 0.0015 |
| Win rate | 50.00% |



## Strategy Comparison (Test Set)

| Strategy | Net Profit | Trades | Sharpe | Max DD |
|----------|-----------|--------|--------|--------|
| A Fair Value | $-29.51 | 2 | -6.692 | 0.00% |
| B Latency | $216,793.81 | 14761 | 5.148 | -1.43% |
| C Passive MM | $3,542.78 | 5889 | 0.420 | -10.64% |

## Monte Carlo (10,000 simulations)

| Metric | Value |
|--------|-------|
| Expected monthly return | $-29.87 |
| P(losing month) | 74.97% |
| 5th percentile | $-79.01 |
| 50th percentile | $-29.51 |
| 95th percentile | $19.99 |
| Expected max drawdown | -0.19% |
| P(losing 10%) | 0.00% |
| P(losing 20%) | 0.00% |

## Scalable Capital Estimates

{
  "5000": {
    "achievable": false,
    "reason": "negative average PnL in backtest",
    "required_trades_per_month": null
  },
  "10000": {
    "achievable": false,
    "reason": "negative average PnL in backtest",
    "required_trades_per_month": null
  },
  "20000": {
    "achievable": false,
    "reason": "negative average PnL in backtest",
    "required_trades_per_month": null
  }
}

## Calibration Summary

| bucket   |   count |   predicted |   actual |        error |
|:---------|--------:|------------:|---------:|-------------:|
| 0%-10%   |    2525 |   0.0044536 |        0 |   0.0044536  |
| 10%-20%  |       1 |   0.161575  |        0 |   0.161575   |
| 20%-30%  |       0 | nan         |      nan | nan          |
| 30%-40%  |       0 | nan         |      nan | nan          |
| 40%-50%  |       0 | nan         |      nan | nan          |
| 50%-60%  |       0 | nan         |      nan | nan          |
| 60%-70%  |       0 | nan         |      nan | nan          |
| 70%-80%  |       0 | nan         |      nan | nan          |
| 80%-90%  |       0 | nan         |      nan | nan          |
| 90%-100% |    2934 |   0.995956  |        1 |  -0.00404368 |

## Edge Bucket Analysis

| bucket     |   observations |   trades |   expected_edge |   realized_edge |   profit |        roi |
|:-----------|---------------:|---------:|----------------:|----------------:|---------:|-----------:|
| 0.0%-1.0%  |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 1.0%-2.0%  |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 2.0%-3.0%  |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 3.0%-4.0%  |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 4.0%-5.0%  |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 5.0%-7.5%  |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 7.5%-10.0% |              0 |        0 |      nan        |      nan        |   0      | nan        |
| 10.0%+     |              2 |        2 |        0.100281 |       -0.146562 | -29.5123 |  -0.147562 |

## Major Risks

1. **Data quality**: Results depend entirely on historical data quality and availability.
2. **Synthetic data caveat**: If using demo data, results are NOT evidence of real edge.
3. **Liquidity**: Order-book depth may not support scaling to target position sizes.
4. **Model calibration**: Poor calibration undermines fair value signals.
5. **Regime change**: Crypto volatility regimes shift; past edges may not persist.
6. **Execution latency**: Real-world latency may eliminate observed microstructure advantages.

## Estimated Scalable Capital

Based on test-set scalability analysis: see `scalability` section in backtest JSON output.

## Does Evidence Support a Real Edge?

**NO — synthetic demo data only.** The pipeline ran successfully but results cannot support claims of a real trading edge. Import real historical prediction-market order book data before drawing conclusions.
