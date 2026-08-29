"""Strategy B: Latency/momentum discrepancy."""

from __future__ import annotations

import pandas as pd


def compute_latency_signals(
    df: pd.DataFrame,
    lag_ms: int,
    min_move_pct: float = 0.0005,
    position_size_usd: float = 100.0,
) -> pd.DataFrame:
    """
    Test whether underlying price moves lead prediction-market repricing.
    Uses only data available at each timestamp (no look-ahead).
    """
    df = df.sort_values(["market_id", "timestamp"]).copy()
    lag_seconds = lag_ms / 1000.0

    trades = []
    for market_id, grp in df.groupby("market_id"):
        grp = grp.sort_values("timestamp").reset_index(drop=True)
        grp["spot_change"] = grp["spot_price"].pct_change()
        grp["prob_change"] = grp["market_probability"].diff()

        for i in range(1, len(grp)):
            row = grp.iloc[i]
            # Find prior snapshot approximately lag_seconds ago
            target_ts = row["timestamp"] - pd.Timedelta(seconds=lag_seconds)
            prior = grp[grp["timestamp"] <= target_ts]
            if prior.empty:
                continue
            prior_row = prior.iloc[-1]
            spot_move = (row["spot_price"] - prior_row["spot_price"]) / prior_row["spot_price"]
            prob_move = row["market_probability"] - prior_row["market_probability"]

            if abs(spot_move) < min_move_pct:
                continue

            # Signal: underlying moved but market hasn't adjusted yet
            expected_prob_shift = spot_move * 5  # rough sensitivity
            discrepancy = expected_prob_shift - prob_move

            if abs(discrepancy) < 0.01:
                continue

            side = "YES" if discrepancy > 0 else "NO"
            entry = row.executable_yes if side == "YES" else row.executable_no
            settlement = row.settlement_result

            if side == "YES":
                pnl = position_size_usd * (settlement - entry) - position_size_usd * 0.001
                realized_edge = settlement - entry
            else:
                pnl = position_size_usd * ((1 - settlement) - entry) - position_size_usd * 0.001
                realized_edge = (1 - settlement) - entry

            trades.append(
                {
                    "market_id": market_id,
                    "asset": row["asset"],
                    "timestamp": row["timestamp"],
                    "side": side,
                    "entry_price": entry,
                    "exit_price": float(settlement),
                    "size_usd": position_size_usd,
                    "gross_edge": abs(discrepancy),
                    "realized_edge": realized_edge,
                    "fees": position_size_usd * 0.001,
                    "slippage": 0.0,
                    "pnl": pnl,
                    "settlement_result": settlement,
                    "time_remaining_seconds": row["time_remaining_seconds"],
                    "duration_minutes": row["duration_minutes"],
                    "lag_ms": lag_ms,
                    "spot_move": spot_move,
                    "prob_move": prob_move,
                }
            )
    return pd.DataFrame(trades)
