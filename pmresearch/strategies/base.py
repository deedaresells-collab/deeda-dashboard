"""Shared strategy types and helpers."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TradeSignal:
    market_id: str
    asset: str
    timestamp: object
    side: str  # YES or NO
    gross_edge: float
    model_probability: float
    strategy: str
    regime: str
    confidence: float
    entry_reason: str = ""
    duration_minutes: int = 0
    metadata: dict = field(default_factory=dict)


def executable_prices(row) -> tuple[float, float, float, float]:
    yes_ask = getattr(row, "executable_yes", None) or row.yes_ask
    no_ask = getattr(row, "executable_no", None) or row.no_ask
    return yes_ask, no_ask, row.yes_ask_depth, row.no_ask_depth


def model_prob(row, use_adjusted: bool = True) -> float:
    if use_adjusted and hasattr(row, "adjusted_probability") and row.adjusted_probability is not None:
        return row.adjusted_probability
    if hasattr(row, "baseline_probability_yes"):
        return row.baseline_probability_yes
    return getattr(row, "model_probability", 0.5)


def uncertainty_buffer(row, default: float = 0.01) -> float:
    return getattr(row, "uncertainty_buffer", default) or default
