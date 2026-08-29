"""Exit logic — edge, regime, risk, and settlement-based exits."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from pmresearch.execution.correlation import OpenPosition


class ExitReason(str, Enum):
    EDGE_BELOW_THRESHOLD = "edge_below_threshold"
    MODEL_DIRECTION_CHANGE = "model_direction_change"
    REGIME_INVALIDATED = "regime_invalidated"
    MAX_RISK = "max_risk"
    SETTLEMENT_APPROACH = "settlement_approach"
    CIRCUIT_BREAKER = "circuit_breaker"


@dataclass
class ExitSignal:
    should_exit: bool
    reason: ExitReason | None = None
    exit_price: float | None = None


def check_exit(
    pos: OpenPosition,
    current_yes_bid: float,
    current_yes_ask: float,
    current_no_bid: float,
    current_no_ask: float,
    model_probability: float,
    current_regime: str,
    time_remaining_seconds: float,
    min_edge: float,
    uncertainty_buffer: float = 0.01,
    max_position_loss_pct: float = 0.15,
    settlement_buffer_seconds: float = 30.0,
) -> ExitSignal:
    """Evaluate whether an open position should be closed."""
    if pos.side == "YES":
        mark = current_yes_bid
        current_edge = model_probability - current_yes_ask
        entry_direction = 1
    else:
        mark = current_no_bid
        current_edge = (1 - model_probability) - current_no_ask
        entry_direction = -1

    # 1. Edge below threshold
    net_edge = current_edge - uncertainty_buffer
    if net_edge < min_edge:
        return ExitSignal(True, ExitReason.EDGE_BELOW_THRESHOLD, mark)

    # 2. Model direction change
    if pos.side == "YES" and model_probability < pos.entry_price:
        return ExitSignal(True, ExitReason.MODEL_DIRECTION_CHANGE, mark)
    if pos.side == "NO" and (1 - model_probability) < pos.entry_price:
        return ExitSignal(True, ExitReason.MODEL_DIRECTION_CHANGE, mark)

    # 3. Regime invalidated
    regime_strategy_map = {
        "mean_reversion": "MEAN_REVERTING",
        "momentum": "MOMENTUM_TRENDING",
        "fair_value": None,
        "order_flow": None,
        "regime_switching": None,
    }
    required = regime_strategy_map.get(pos.strategy)
    if required and current_regime != required:
        return ExitSignal(True, ExitReason.REGIME_INVALIDATED, mark)

    # 4. Max risk threshold (unrealized loss)
    if pos.side == "YES":
        unrealized = (mark - pos.entry_price) / max(pos.entry_price, 0.01)
    else:
        unrealized = (mark - pos.entry_price) / max(pos.entry_price, 0.01)
    if unrealized < -max_position_loss_pct:
        return ExitSignal(True, ExitReason.MAX_RISK, mark)

    # 5. Settlement approaching without sufficient edge
    if time_remaining_seconds < settlement_buffer_seconds and net_edge < min_edge * 2:
        return ExitSignal(True, ExitReason.SETTLEMENT_APPROACH, mark)

    return ExitSignal(False)
