"""Strategy C: Passive market making with adverse selection."""

from __future__ import annotations

import pandas as pd

from pmresearch.execution.costs import simulate_passive_fill


def generate_mm_trades(
    df: pd.DataFrame,
    spread: float,
    position_size_usd: float = 100.0,
    fee_pct: float = 0.001,
) -> pd.DataFrame:
    """Simulate passive quoting around fair value."""
    trades = []
    for i, row in enumerate(df.itertuples(index=False)):
        fair = row.model_probability
        bid_quote = max(0.01, fair - spread / 2)
        ask_quote = min(0.99, fair + spread / 2)
        market_mid = row.market_probability

        # Underlying move since last snapshot
        move_pct = 0.0
        if i > 0:
            prev = df.iloc[i - 1]
            if prev["market_id"] == row.market_id:
                move_pct = (row.spot_price - prev["spot_price"]) / prev["spot_price"]

        for side, quote, depth_col in [
            ("BID", bid_quote, "yes_bid_depth"),
            ("ASK", ask_quote, "yes_ask_depth"),
        ]:
            depth = getattr(row, depth_col, 1000)
            result = simulate_passive_fill(
                side=side,
                quote_price=quote,
                size_usd=position_size_usd / 2,
                market_mid=market_mid,
                underlying_move_pct=move_pct,
                available_depth=depth,
            )
            if not result.filled:
                continue

            settlement = row.settlement_result
            if side == "BID":
                pnl = result.fill_size_usd * (settlement - result.fill_price) - result.fees
                realized_edge = settlement - result.fill_price
                trade_side = "YES"
            else:
                # Sold YES (ask hit) -> short YES exposure
                pnl = result.fill_size_usd * (result.fill_price - settlement) - result.fees
                realized_edge = result.fill_price - settlement
                trade_side = "SELL_YES"

            trades.append(
                {
                    "market_id": row.market_id,
                    "asset": row.asset,
                    "timestamp": row.timestamp,
                    "side": trade_side,
                    "entry_price": result.fill_price,
                    "exit_price": float(settlement),
                    "size_usd": result.fill_size_usd,
                    "gross_edge": spread / 2,
                    "realized_edge": realized_edge,
                    "fees": result.fees,
                    "slippage": 0.0,
                    "pnl": pnl,
                    "settlement_result": settlement,
                    "time_remaining_seconds": row.time_remaining_seconds,
                    "duration_minutes": row.duration_minutes,
                    "spread": spread,
                }
            )
    return pd.DataFrame(trades)
