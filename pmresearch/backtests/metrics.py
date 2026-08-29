"""Backtest performance metrics."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd


def compute_metrics(trades: pd.DataFrame, initial_capital: float = 10000.0) -> dict[str, Any]:
    if trades.empty:
        return _empty_metrics()

    pnl = trades["pnl"]
    cumulative = pnl.cumsum()
    equity = initial_capital + cumulative
    returns = pnl / initial_capital

    wins = pnl[pnl > 0]
    losses = pnl[pnl <= 0]
    gross_profit = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0

    peak = equity.cummax()
    drawdown = (equity - peak) / peak
    max_dd = float(drawdown.min()) if len(drawdown) else 0.0

    mean_ret = returns.mean()
    std_ret = returns.std()
    sharpe = float(mean_ret / std_ret * np.sqrt(252)) if std_ret > 0 else 0.0

    downside = returns[returns < 0]
    down_std = downside.std()
    sortino = float(mean_ret / down_std * np.sqrt(252)) if down_std > 0 else 0.0

    losing_streak = _longest_losing_streak(pnl)

    total_fees = trades["fees"].sum()
    total_slippage = trades["slippage"].sum()
    capital_used = trades["size_usd"].sum()
    turnover = capital_used / initial_capital if initial_capital > 0 else 0.0

    return {
        "num_trades": int(len(trades)),
        "win_rate": float((pnl > 0).mean()),
        "avg_entry_price": float(trades["entry_price"].mean()),
        "avg_gross_edge": float(trades["gross_edge"].mean()),
        "realized_edge": float(trades["realized_edge"].mean()),
        "total_return": float(pnl.sum() / initial_capital),
        "net_profit": float(pnl.sum()),
        "return_on_capital": float(pnl.sum() / capital_used) if capital_used > 0 else 0.0,
        "max_drawdown": max_dd,
        "avg_profit_per_trade": float(pnl.mean()),
        "median_profit_per_trade": float(pnl.median()),
        "profit_factor": float(gross_profit / gross_loss) if gross_loss > 0 else float("inf"),
        "sharpe_ratio": sharpe,
        "sortino_ratio": sortino,
        "longest_losing_streak": losing_streak,
        "capital_utilization": float(capital_used / (initial_capital * max(len(trades), 1))),
        "turnover": turnover,
        "fees_paid": float(total_fees),
        "slippage": float(total_slippage),
    }


def _empty_metrics() -> dict[str, Any]:
    return {k: 0.0 for k in [
        "num_trades", "win_rate", "avg_entry_price", "avg_gross_edge", "realized_edge",
        "total_return", "net_profit", "return_on_capital", "max_drawdown",
        "avg_profit_per_trade", "median_profit_per_trade", "profit_factor",
        "sharpe_ratio", "sortino_ratio", "longest_losing_streak",
        "capital_utilization", "turnover", "fees_paid", "slippage",
    ]}


def _longest_losing_streak(pnl: pd.Series) -> int:
    max_streak = streak = 0
    for p in pnl:
        if p <= 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
    return max_streak


def metrics_by_group(trades: pd.DataFrame, group_col: str, initial_capital: float = 10000.0) -> dict[str, dict]:
    if trades.empty or group_col not in trades.columns:
        return {}
    result = {}
    for name, grp in trades.groupby(group_col):
        result[str(name)] = compute_metrics(grp, initial_capital)
    return result


def break_even_edge(trades: pd.DataFrame) -> float:
    """Estimate minimum gross edge needed to break even after costs."""
    if trades.empty:
        return 0.0
    avg_costs = (trades["fees"] + trades["slippage"]).sum() / trades["size_usd"].sum()
    return float(avg_costs)


def serialize_metrics(metrics: dict) -> str:
    return json.dumps(metrics, indent=2, default=str)
