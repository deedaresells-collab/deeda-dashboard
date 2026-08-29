"""Strategy D — Order flow."""

from __future__ import annotations

import pandas as pd

from pmresearch.strategies.base import TradeSignal, executable_prices, model_prob, uncertainty_buffer


def generate_signals(
    df: pd.DataFrame,
    min_edge: float = 0.02,
    ob_threshold: float = 0.20,
    latency_buffer: float = 0.005,
) -> list[TradeSignal]:
    """Trade when order-book imbalance implies mispriced prediction market."""
    signals = []
    for row in df.itertuples(index=False):
        ob = getattr(row, "ob_imbalance_regime", None) or getattr(row, "ob_imbalance", 0) or 0
        if abs(ob) < ob_threshold:
            continue

        mp = model_prob(row, use_adjusted=False)
        buf = uncertainty_buffer(row) + latency_buffer
        yes_ask, no_ask, _, _ = executable_prices(row)

        if ob > ob_threshold:
            implied = min(0.90, row.market_probability + abs(ob) * 0.1)
            edge = implied - yes_ask - buf
            if edge < min_edge:
                continue
            signals.append(TradeSignal(
                market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
                side="YES", gross_edge=edge, model_probability=implied,
                strategy="order_flow", regime=getattr(row, "regime", "UNCERTAIN"),
                confidence=min(abs(ob), 1.0),
                entry_reason="ob_imbalance_bullish",
                duration_minutes=getattr(row, "duration_minutes", 0),
                metadata={"ob_imbalance": ob},
            ))
        elif ob < -ob_threshold:
            implied = min(0.90, (1 - row.market_probability) + abs(ob) * 0.1)
            edge = implied - no_ask - buf
            if edge < min_edge:
                continue
            signals.append(TradeSignal(
                market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
                side="NO", gross_edge=edge, model_probability=implied,
                strategy="order_flow", regime=getattr(row, "regime", "UNCERTAIN"),
                confidence=min(abs(ob), 1.0),
                entry_reason="ob_imbalance_bearish",
                duration_minutes=getattr(row, "duration_minutes", 0),
                metadata={"ob_imbalance": ob},
            ))
    return signals
