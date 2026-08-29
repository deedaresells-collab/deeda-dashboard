"""Monte Carlo simulation for trade sequence uncertainty."""

from __future__ import annotations

import numpy as np
import pandas as pd


def monte_carlo_monthly(
    trades: pd.DataFrame,
    n_simulations: int = 10000,
    trades_per_month: int = 100,
    seed: int = 42,
) -> dict:
    if trades.empty:
        return _empty_mc()

    rng = np.random.default_rng(seed)
    pnls = trades["pnl"].values
    monthly_returns = []

    for _ in range(n_simulations):
        sampled = rng.choice(pnls, size=min(trades_per_month, len(pnls)), replace=True)
        monthly_returns.append(sampled.sum())

    monthly = np.array(monthly_returns)
    initial = 10000.0
    monthly_pct = monthly / initial

    # Drawdown simulation
    max_dds = []
    for _ in range(min(1000, n_simulations)):
        seq = rng.choice(pnls, size=min(500, len(pnls)), replace=True)
        equity = initial + np.cumsum(seq)
        peak = np.maximum.accumulate(equity)
        dd = (equity - peak) / peak
        max_dds.append(dd.min())

    return {
        "simulations": n_simulations,
        "expected_monthly_return": float(monthly.mean()),
        "prob_losing_month": float((monthly < 0).mean()),
        "p5_monthly": float(np.percentile(monthly, 5)),
        "p50_monthly": float(np.percentile(monthly, 50)),
        "p95_monthly": float(np.percentile(monthly, 95)),
        "expected_max_drawdown": float(np.mean(max_dds)),
        "prob_losing_10pct": float((monthly_pct < -0.10).mean()),
        "prob_losing_20pct": float((monthly_pct < -0.20).mean()),
    }


def _empty_mc() -> dict:
    return {k: 0.0 for k in [
        "simulations", "expected_monthly_return", "prob_losing_month",
        "p5_monthly", "p50_monthly", "p95_monthly",
        "expected_max_drawdown", "prob_losing_10pct", "prob_losing_20pct",
    ]}


def scalability_targets(trades: pd.DataFrame, targets: list[float] | None = None) -> dict:
    """Estimate capital/turnover needed for monthly profit targets."""
    targets = targets or [5000, 10000, 20000]
    if trades.empty:
        return {str(t): {"achievable": False, "reason": "no trades"} for t in targets}

    avg_pnl = trades["pnl"].mean()
    avg_size = trades["size_usd"].mean()
    n_trades = len(trades)
    days = (trades["timestamp"].max() - trades["timestamp"].min()).days or 1
    trades_per_month = n_trades / days * 30

    results = {}
    for target in targets:
        if avg_pnl <= 0:
            results[str(target)] = {
                "achievable": False,
                "reason": "negative average PnL in backtest",
                "required_trades_per_month": target / avg_pnl if avg_pnl > 0 else None,
            }
            continue
        required_trades = target / avg_pnl
        scale_factor = required_trades / trades_per_month if trades_per_month > 0 else float("inf")
        required_capital = avg_size * scale_factor * 2  # buffer
        results[str(target)] = {
            "achievable": scale_factor < 50,
            "required_trades_per_month": required_trades,
            "scale_factor_vs_backtest": scale_factor,
            "estimated_bankroll": required_capital,
            "avg_capital_per_trade": avg_size * scale_factor,
            "monthly_turnover": avg_size * required_trades,
        }
    return results
