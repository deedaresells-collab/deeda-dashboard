"""Strategy A: Fair value mispricing (vectorized)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from pmresearch.execution.costs import simulate_market_order


def generate_signals_a(
    df: pd.DataFrame,
    minimum_edge: float,
    position_size_usd: float,
    fee_pct: float,
    slippage_bps: float,
    min_liquidity: float,
) -> pd.DataFrame:
    """Generate trade signals when model edge exceeds threshold."""
    if df.empty:
        return pd.DataFrame()

    gross_edge_yes = df["model_probability"] - df["executable_yes"]
    gross_edge_no = (1 - df["model_probability"]) - df["executable_no"]

    yes_mask = gross_edge_yes >= minimum_edge
    no_mask = (~yes_mask) & (gross_edge_no >= minimum_edge)
    signal_mask = yes_mask | no_mask
    candidates = df[signal_mask].copy()

    if candidates.empty:
        return pd.DataFrame()

    candidates["side"] = np.where(yes_mask[signal_mask], "YES", "NO")
    candidates["gross_edge"] = np.where(
        candidates["side"] == "YES",
        gross_edge_yes[signal_mask].values,
        gross_edge_no[signal_mask].values,
    )

    trades = []
    for row in candidates.itertuples(index=False):
        exec_result = simulate_market_order(
            side=row.side,
            size_usd=position_size_usd,
            yes_ask=row.executable_yes,
            no_ask=row.executable_no,
            yes_ask_depth=row.yes_ask_depth,
            no_ask_depth=row.no_ask_depth,
            fee_pct=fee_pct,
            slippage_bps=slippage_bps,
            min_liquidity=min_liquidity,
        )
        if not exec_result.filled:
            continue

        settlement = row.settlement_result
        if row.side == "YES":
            pnl = exec_result.fill_size_usd * (settlement - exec_result.fill_price) - exec_result.fees
            realized_edge = settlement - exec_result.fill_price
        else:
            pnl = exec_result.fill_size_usd * ((1 - settlement) - exec_result.fill_price) - exec_result.fees
            realized_edge = (1 - settlement) - exec_result.fill_price

        trades.append({
            "market_id": row.market_id,
            "asset": row.asset,
            "timestamp": row.timestamp,
            "side": row.side,
            "entry_price": exec_result.fill_price,
            "exit_price": float(settlement) if row.side == "YES" else float(1 - settlement),
            "size_usd": exec_result.fill_size_usd,
            "gross_edge": row.gross_edge,
            "realized_edge": realized_edge,
            "fees": exec_result.fees,
            "slippage": exec_result.slippage,
            "pnl": pnl,
            "settlement_result": settlement,
            "time_remaining_seconds": row.time_remaining_seconds,
            "duration_minutes": row.duration_minutes,
            "model_probability": row.model_probability,
            "minimum_edge": minimum_edge,
        })
    return pd.DataFrame(trades)
