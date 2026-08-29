"""Calibration analysis for model predictions."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def calibration_table(
    df: pd.DataFrame,
    prob_col: str = "model_probability",
    outcome_col: str = "settlement_result",
    buckets: list[list[float]] | None = None,
) -> pd.DataFrame:
    buckets = buckets or [
        [0.0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5],
        [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0],
    ]
    rows = []
    for lo, hi in buckets:
        mask = (df[prob_col] >= lo) & (df[prob_col] < hi if hi < 1.0 else df[prob_col] <= hi)
        subset = df[mask]
        if subset.empty:
            rows.append({"bucket": f"{lo:.0%}-{hi:.0%}", "count": 0, "predicted": np.nan, "actual": np.nan, "error": np.nan})
            continue
        predicted = subset[prob_col].mean()
        actual = subset[outcome_col].mean()
        rows.append({
            "bucket": f"{lo:.0%}-{hi:.0%}",
            "count": len(subset),
            "predicted": predicted,
            "actual": actual,
            "error": predicted - actual,
        })
    return pd.DataFrame(rows)


def plot_calibration(table: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    valid = table[table["count"] > 0]
    if valid.empty:
        return
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot([0, 1], [0, 1], "k--", label="Perfect calibration")
    ax.scatter(valid["predicted"], valid["actual"], s=valid["count"] / 5, alpha=0.7, label="Model")
    ax.set_xlabel("Predicted probability")
    ax.set_ylabel("Actual settlement frequency")
    ax.set_title("Model Calibration")
    ax.legend()
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    fig.tight_layout()
    fig.savefig(output_path, dpi=120)
    plt.close(fig)


def edge_bucket_analysis(
    trades: pd.DataFrame,
    buckets: list[list[float]] | None = None,
) -> pd.DataFrame:
    buckets = buckets or [
        [0.0, 0.01], [0.01, 0.02], [0.02, 0.03], [0.03, 0.04],
        [0.04, 0.05], [0.05, 0.075], [0.075, 0.10], [0.10, 1.0],
    ]
    rows = []
    for lo, hi in buckets:
        mask = (trades["gross_edge"] >= lo) & (trades["gross_edge"] < hi)
        subset = trades[mask]
        rows.append({
            "bucket": f"{lo:.1%}-{hi:.1%}" if hi < 1 else f"{lo:.1%}+",
            "observations": len(subset),
            "trades": len(subset),
            "expected_edge": subset["gross_edge"].mean() if len(subset) else np.nan,
            "realized_edge": subset["realized_edge"].mean() if len(subset) else np.nan,
            "profit": subset["pnl"].sum() if len(subset) else 0.0,
            "roi": subset["pnl"].sum() / subset["size_usd"].sum() if len(subset) and subset["size_usd"].sum() > 0 else np.nan,
        })
    return pd.DataFrame(rows)
