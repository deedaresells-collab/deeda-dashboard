"""Strategy comparison and regime analysis reports."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from pmresearch.config import ROOT
from pmresearch.reports.calibration import edge_bucket_analysis


def build_comparison_report(results: dict[str, Any], data_type: str = "UNKNOWN") -> dict[str, Any]:
    """Build full comparison report with edge buckets and regime analysis."""
    strategies = results.get("strategies", {})
    trades_map = results.get("trades", {})
    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_type": data_type,
        "split": results.get("split", "test"),
        "test_size": results.get("test_size", 0),
        "config": results.get("config", {}),
        "strategies": {},
        "edge_buckets": {},
        "regime_analysis": {},
    }

    for name, metrics in strategies.items():
        report["strategies"][name] = _strategy_summary(metrics)

    for name, trades in trades_map.items():
        if isinstance(trades, pd.DataFrame) and not trades.empty:
            if "predicted_edge" in trades.columns or "gross_edge" in trades.columns:
                edge_col = "predicted_edge" if "predicted_edge" in trades.columns else "gross_edge"
                t = trades.copy()
                t["gross_edge"] = t[edge_col]
                report["edge_buckets"][name] = edge_bucket_analysis(t).to_dict(orient="records")
            report["regime_analysis"][name] = _regime_breakdown(trades)

    report["regime_distribution"] = results.get("regime_distribution", {})
    return report


def _strategy_summary(metrics: dict) -> dict:
    keys = [
        "num_trades", "win_rate", "net_profit", "return_on_capital", "max_drawdown",
        "sharpe_ratio", "sortino_ratio", "profit_factor", "avg_profit_per_trade",
        "avg_gross_edge", "realized_edge", "fees_paid", "slippage", "turnover",
        "longest_losing_streak",
    ]
    out = {k: metrics.get(k, metrics.get("avg_predicted_edge" if k == "avg_gross_edge" else k, 0)) for k in keys}
    if "avg_predicted_edge" in metrics:
        out["avg_predicted_edge"] = metrics["avg_predicted_edge"]
    out["by_asset"] = metrics.get("by_asset", {})
    out["by_duration"] = metrics.get("by_duration", {})
    out["by_regime"] = metrics.get("by_regime", {})
    out["circuit_breaker"] = metrics.get("circuit_breaker", {})
    return out


def _regime_breakdown(trades: pd.DataFrame) -> dict:
    if "regime" not in trades.columns:
        return {}
    breakdown = {}
    for regime, grp in trades.groupby("regime"):
        breakdown[str(regime)] = {
            "trades": len(grp),
            "net_profit": float(grp["pnl"].sum()),
            "win_rate": float((grp["pnl"] > 0).mean()),
            "avg_predicted_edge": float(grp.get("predicted_edge", grp.get("gross_edge", pd.Series(0))).mean()),
            "avg_realized_edge": float(grp["realized_edge"].mean()),
        }
    return breakdown


def save_comparison_report(report: dict[str, Any], output_dir: Path | None = None) -> tuple[Path, Path]:
    output_dir = output_dir or ROOT / "reports" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "strategy_comparison.json"
    md_path = ROOT / "strategy_comparison.md"
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    md_path.write_text(_render_markdown(report), encoding="utf-8")
    return json_path, md_path


def _render_markdown(report: dict) -> str:
    data_type = report.get("data_type", "UNKNOWN")
    lines = [
        "# Strategy Comparison Report",
        "",
        f"Generated: {report.get('generated_at')}",
        f"Data type: **{data_type}**",
        f"Split: {report.get('split')} ({report.get('test_size', 0)} observations)",
        "",
        "> **WARNING:** Synthetic demo data is for pipeline validation only. "
        "Results are NOT evidence of real profitability.",
        "",
        "## Strategy Comparison (Out-of-Sample)",
        "",
        "| Strategy | Trades | Net P&L | Win Rate | Sharpe | Max DD | PF | Pred Edge | Real Edge |",
        "|----------|--------|---------|----------|--------|--------|-----|-----------|-----------|",
    ]
    for name, m in report.get("strategies", {}).items():
        lines.append(
            f"| {name} | {m.get('num_trades', 0):.0f} | ${m.get('net_profit', 0):,.2f} | "
            f"{m.get('win_rate', 0):.1%} | {m.get('sharpe_ratio', 0):.3f} | "
            f"{m.get('max_drawdown', 0):.2%} | {m.get('profit_factor', 0):.2f} | "
            f"{m.get('avg_predicted_edge', m.get('avg_gross_edge', 0)):.4f} | {m.get('realized_edge', 0):.4f} |"
        )

    lines.extend(["", "## Regime Analysis", ""])
    for name, regimes in report.get("regime_analysis", {}).items():
        lines.append(f"### {name}")
        if not regimes:
            lines.append("No regime data.")
            continue
        lines.append("| Regime | Trades | Net P&L | Win Rate | Pred Edge | Real Edge |")
        lines.append("|--------|--------|---------|----------|-----------|-----------|")
        for regime, stats in regimes.items():
            lines.append(
                f"| {regime} | {stats['trades']} | ${stats['net_profit']:,.2f} | "
                f"{stats['win_rate']:.1%} | {stats['avg_predicted_edge']:.4f} | {stats['avg_realized_edge']:.4f} |"
            )
        lines.append("")

    lines.extend(["", "## Edge Bucket Analysis", ""])
    for name, buckets in report.get("edge_buckets", {}).items():
        lines.append(f"### {name}")
        if not buckets:
            lines.append("No trades.")
            continue
        lines.append("| Bucket | Trades | Expected | Realized | Profit |")
        lines.append("|--------|--------|----------|----------|--------|")
        for b in buckets:
            exp = b.get("expected_edge", 0)
            real = b.get("realized_edge", 0)
            flag = " ⚠️" if exp and real and real < exp * 0.5 else ""
            lines.append(
                f"| {b.get('bucket', '')} | {b.get('trades', 0)} | "
                f"{exp:.4f} | {real:.4f}{flag} | ${b.get('profit', 0):,.2f} |"
            )
        lines.append("")

    lines.append("## Evidence Assessment\n")
    if data_type == "SYNTHETIC_DEMO":
        lines.append("**No evidence of real edge.** Synthetic data validates pipeline only.")
    else:
        lines.append("Review per-strategy OOS metrics. No strategy assumed profitable.")

    return "\n".join(lines)
