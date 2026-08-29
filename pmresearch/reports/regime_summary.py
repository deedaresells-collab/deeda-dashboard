"""Regime component comparison report."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pmresearch.config import ROOT


def generate_regime_report(results: dict[str, Any], output_path: Path | None = None) -> str:
    output_path = output_path or ROOT / "regime_results_summary.md"
    components = results.get("components", {})
    min_edge = results.get("min_edge", 0.02)

    rows = []
    for name, metrics in components.items():
        rows.append({
            "component": name,
            "trades": metrics.get("num_trades", 0),
            "net_profit": metrics.get("net_profit", 0),
            "win_rate": metrics.get("win_rate", 0),
            "sharpe": metrics.get("sharpe_ratio", 0),
            "max_dd": metrics.get("max_drawdown", 0),
            "profit_factor": metrics.get("profit_factor", 0),
            "realized_edge": metrics.get("realized_edge", 0),
            "cb_triggered": metrics.get("circuit_breaker", {}).get("triggered", False),
        })

    # Sort by net profit for display (not selection — all reported equally)
    rows.sort(key=lambda r: r["net_profit"], reverse=True)

    table_lines = [
        "| Component | Trades | Net P&L | Win Rate | Sharpe | Max DD | PF | Realized Edge | CB Triggered |",
        "|-----------|--------|---------|----------|--------|--------|-----|---------------|--------------|",
    ]
    for r in rows:
        table_lines.append(
            f"| {r['component']} | {r['trades']:.0f} | ${r['net_profit']:,.2f} | "
            f"{r['win_rate']:.1%} | {r['sharpe']:.3f} | {r['max_dd']:.2%} | "
            f"{r['profit_factor']:.2f} | {r['realized_edge']:.4f} | {r['cb_triggered']} |"
        )

    best = rows[0] if rows else None
    evidence = _assess_regime_evidence(rows, results.get("data_type", "UNKNOWN"))

    content = f"""# Regime Engine Results

Generated: {datetime.now(timezone.utc).isoformat()}
Min edge threshold: {min_edge:.1%}

## Component Comparison (Out-of-Sample)

{chr(10).join(table_lines)}

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

{f"**{best['component']}** — ${best['net_profit']:,.2f} net, {best['trades']:.0f} trades, Sharpe {best['sharpe']:.3f}" if best else "No trades generated."}

## Evidence Assessment

{evidence}

## Risk Controls Applied

- Adaptive position sizing (edge, confidence, vol, liquidity, correlation)
- Correlated exposure limits across BTC/ETH/SOL
- Per-position risk limits
- Daily loss limit
- Portfolio drawdown circuit breaker (halts new trades, closes positions)
"""
    output_path.write_text(content, encoding="utf-8")
    return content


def _assess_regime_evidence(rows: list[dict], data_type: str = "UNKNOWN") -> str:
    if data_type == "SYNTHETIC_DEMO":
        return (
            "**INCONCLUSIVE — synthetic demo data.** Components show varying OOS results but "
            "these cannot support claims of a real edge. Import real historical data before "
            "drawing conclusions."
        )
    if not rows:
        return "Insufficient data."
    profitable = [r for r in rows if r["net_profit"] > 0 and r["trades"] >= 10]
    if not profitable:
        return (
            "**No component shows convincing out-of-sample edge.** "
            "All approaches are unprofitable or have too few trades to draw conclusions."
        )
    best = max(profitable, key=lambda r: r["sharpe"])
    if best["sharpe"] < 0.5:
        return (
            f"**{best['component']}** is marginally profitable but Sharpe < 0.5. "
            "Insufficient evidence of a repeatable edge."
        )
    return (
        f"**{best['component']}** shows positive OOS P&L with {best['trades']:.0f} trades "
        f"and Sharpe {best['sharpe']:.3f}. Requires validation on real data before "
        "any capital allocation."
    )
