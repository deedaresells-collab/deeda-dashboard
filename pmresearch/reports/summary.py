"""Generate research reports and summaries."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from pmresearch.config import ROOT
from pmresearch.reports.calibration import calibration_table, edge_bucket_analysis, plot_calibration
from pmresearch.reports.monte_carlo import monte_carlo_monthly, scalability_targets


def save_backtest_results(results: dict[str, Any], output_dir: Path | None = None) -> Path:
    output_dir = output_dir or ROOT / "reports" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # Strip non-serializable trades for JSON
    serializable = {k: v for k, v in results.items() if k != "test_trades_a"}
    path = output_dir / f"backtest_{ts}.json"
    path.write_text(json.dumps(serializable, indent=2, default=str), encoding="utf-8")

    trades = results.get("test_trades_a")
    if isinstance(trades, pd.DataFrame) and not trades.empty:
        trades.to_parquet(output_dir / f"test_trades_{ts}.parquet", index=False)

    return path


def generate_results_summary(
    results: dict[str, Any],
    calibration_df: pd.DataFrame,
    edge_df: pd.DataFrame,
    mc_results: dict,
    scalability: dict,
    data_type: str = "UNKNOWN",
    output_path: Path | None = None,
) -> str:
    output_path = output_path or ROOT / "results_summary.md"

    strategies = results.get("strategies", {})
    best_name = "A_fair_value"
    best_test = strategies.get(best_name, {}).get("test", {})
    val = strategies.get(best_name, {}).get("validation", {})

    overfit_flag = ""
    if val.get("net_profit", 0) > 0 and best_test.get("net_profit", 0) < 0:
        overfit_flag = "WARNING: Validation profitable but test unprofitable — possible overfitting."
    elif val.get("net_profit", 0) > best_test.get("net_profit", 0) * 2:
        overfit_flag = "CAUTION: Large validation/test performance gap."

    evidence = _assess_edge(best_test, mc_results, data_type)

    content = f"""# Results Summary

Generated: {datetime.now(timezone.utc).isoformat()}

**Data type:** {data_type}

## Best Strategy

**Strategy A — Fair Value Mispricing**
- Selected parameter: min_edge = {strategies.get('A_fair_value', {}).get('selected_parameter', 'N/A')}

## Out-of-Sample (Test) Results

| Metric | Value |
|--------|-------|
| Trade count | {best_test.get('num_trades', 0):.0f} |
| Net profit | ${best_test.get('net_profit', 0):,.2f} |
| ROI | {best_test.get('return_on_capital', 0):.2%} |
| Max drawdown | {best_test.get('max_drawdown', 0):.2%} |
| Sharpe ratio | {best_test.get('sharpe_ratio', 0):.3f} |
| Profit factor | {best_test.get('profit_factor', 0):.3f} |
| Average gross edge | {best_test.get('avg_gross_edge', 0):.4f} |
| Realized edge | {best_test.get('realized_edge', 0):.4f} |
| Break-even edge | {best_test.get('break_even_edge', 0):.4f} |
| Win rate | {best_test.get('win_rate', 0):.2%} |

{overfit_flag}

## Strategy Comparison (Test Set)

| Strategy | Net Profit | Trades | Sharpe | Max DD |
|----------|-----------|--------|--------|--------|
| A Fair Value | ${strategies.get('A_fair_value', {}).get('test', {}).get('net_profit', 0):,.2f} | {strategies.get('A_fair_value', {}).get('test', {}).get('num_trades', 0):.0f} | {strategies.get('A_fair_value', {}).get('test', {}).get('sharpe_ratio', 0):.3f} | {strategies.get('A_fair_value', {}).get('test', {}).get('max_drawdown', 0):.2%} |
| B Latency | ${strategies.get('B_latency', {}).get('test', {}).get('net_profit', 0):,.2f} | {strategies.get('B_latency', {}).get('test', {}).get('num_trades', 0):.0f} | {strategies.get('B_latency', {}).get('test', {}).get('sharpe_ratio', 0):.3f} | {strategies.get('B_latency', {}).get('test', {}).get('max_drawdown', 0):.2%} |
| C Passive MM | ${strategies.get('C_passive_mm', {}).get('test', {}).get('net_profit', 0):,.2f} | {strategies.get('C_passive_mm', {}).get('test', {}).get('num_trades', 0):.0f} | {strategies.get('C_passive_mm', {}).get('test', {}).get('sharpe_ratio', 0):.3f} | {strategies.get('C_passive_mm', {}).get('test', {}).get('max_drawdown', 0):.2%} |

## Monte Carlo ({mc_results.get('simulations', 0):,.0f} simulations)

| Metric | Value |
|--------|-------|
| Expected monthly return | ${mc_results.get('expected_monthly_return', 0):,.2f} |
| P(losing month) | {mc_results.get('prob_losing_month', 0):.2%} |
| 5th percentile | ${mc_results.get('p5_monthly', 0):,.2f} |
| 50th percentile | ${mc_results.get('p50_monthly', 0):,.2f} |
| 95th percentile | ${mc_results.get('p95_monthly', 0):,.2f} |
| Expected max drawdown | {mc_results.get('expected_max_drawdown', 0):.2%} |
| P(losing 10%) | {mc_results.get('prob_losing_10pct', 0):.2%} |
| P(losing 20%) | {mc_results.get('prob_losing_20pct', 0):.2%} |

## Scalable Capital Estimates

{json.dumps(scalability, indent=2)}

## Calibration Summary

{calibration_df.to_markdown(index=False) if hasattr(calibration_df, 'to_markdown') else calibration_df.to_string()}

## Edge Bucket Analysis

{edge_df.to_markdown(index=False) if hasattr(edge_df, 'to_markdown') else edge_df.to_string()}

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

{evidence}
"""
    output_path.write_text(content, encoding="utf-8")
    return content


def _assess_edge(test_metrics: dict, mc_results: dict, data_type: str) -> str:
    if data_type == "SYNTHETIC_DEMO":
        return (
            "**NO — synthetic demo data only.** The pipeline ran successfully but "
            "results cannot support claims of a real trading edge. Import real "
            "historical prediction-market order book data before drawing conclusions."
        )
    net = test_metrics.get("net_profit", 0)
    sharpe = test_metrics.get("sharpe_ratio", 0)
    n = test_metrics.get("num_trades", 0)
    if n < 30:
        return "**INSUFFICIENT DATA** — fewer than 30 out-of-sample trades."
    if net > 0 and sharpe > 0.5 and mc_results.get("prob_losing_month", 1) < 0.4:
        return (
            "**POSSIBLY — but requires confirmation.** Out-of-sample test shows "
            "positive net profit with reasonable risk metrics, but further validation "
            "with independent data and live paper trading is required."
        )
    if net <= 0:
        return (
            "**NO — out-of-sample test unprofitable.** No statistically convincing "
            "evidence of edge with current model and parameters."
        )
    return "**INCONCLUSIVE** — mixed signals; more data and robustness testing needed."
