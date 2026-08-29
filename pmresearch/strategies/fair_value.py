"""Strategy A — Fair value mispricing."""

from __future__ import annotations

import pandas as pd

from pmresearch.strategies.base import TradeSignal, executable_prices, model_prob, uncertainty_buffer


def generate_signals(
    df: pd.DataFrame,
    min_edge: float = 0.02,
    use_adjusted: bool = False,
    latency_buffer: float = 0.005,
) -> list[TradeSignal]:
    """Trade on discrepancy between model probability and executable prices."""
    signals = []
    for row in df.itertuples(index=False):
        mp = model_prob(row, use_adjusted=use_adjusted)
        buf = uncertainty_buffer(row) + latency_buffer
        yes_ask, no_ask, _, _ = executable_prices(row)

        edge_yes = mp - yes_ask - buf
        edge_no = (1 - mp) - no_ask - buf

        if edge_yes >= min_edge:
            signals.append(TradeSignal(
                market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
                side="YES", gross_edge=edge_yes, model_probability=mp,
                strategy="fair_value", regime=getattr(row, "regime", "UNCERTAIN"),
                confidence=getattr(row, "regime_confidence", 0.5),
                entry_reason="fair_value_yes_edge",
                duration_minutes=getattr(row, "duration_minutes", 0),
                metadata={"buffer": buf},
            ))
        elif edge_no >= min_edge:
            signals.append(TradeSignal(
                market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
                side="NO", gross_edge=edge_no, model_probability=1 - mp,
                strategy="fair_value", regime=getattr(row, "regime", "UNCERTAIN"),
                confidence=getattr(row, "regime_confidence", 0.5),
                entry_reason="fair_value_no_edge",
                duration_minutes=getattr(row, "duration_minutes", 0),
                metadata={"buffer": buf},
            ))
    return signals
