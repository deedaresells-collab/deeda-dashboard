"""Thesis-based exit logic."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from pmresearch.risk.exposure import OpenPosition


class ExitReason(str, Enum):
    EDGE_BELOW_THRESHOLD = "edge_below_threshold"
    MODEL_DIRECTION_CHANGE = "model_direction_change"
    REGIME_INVALIDATED = "regime_invalidated"
    MAX_RISK = "max_risk"
    SETTLEMENT_APPROACH = "settlement_approach"
    LIQUIDITY_DETERIORATED = "liquidity_deteriorated"
    PROFIT_TARGET = "profit_target"
    CIRCUIT_BREAKER = "circuit_breaker"
    SETTLEMENT = "settlement"


@dataclass
class ExitSignal:
    should_exit: bool
    reason: ExitReason | None = None
    exit_price: float | None = None


REGIME_STRATEGY_MAP = {
    "mean_reversion": "MEAN_REVERTING",
    "momentum": "MOMENTUM_TRENDING",
}


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
    available_liquidity_usd: float = 1000.0,
    uncertainty_buffer: float = 0.01,
    max_position_loss_pct: float = 0.15,
    settlement_buffer_seconds: float = 30.0,
    min_liquidity_usd: float = 50.0,
    profit_target_pct: float = 0.20,
) -> ExitSignal:
    if pos.side == "YES":
        mark = current_yes_bid
        current_edge = model_probability - current_yes_ask
    else:
        mark = current_no_bid
        current_edge = (1 - model_probability) - current_no_ask

    net_edge = current_edge - uncertainty_buffer
    if net_edge < min_edge:
        return ExitSignal(True, ExitReason.EDGE_BELOW_THRESHOLD, mark)

    if pos.side == "YES" and model_probability < pos.entry_price:
        return ExitSignal(True, ExitReason.MODEL_DIRECTION_CHANGE, mark)
    if pos.side == "NO" and (1 - model_probability) < pos.entry_price:
        return ExitSignal(True, ExitReason.MODEL_DIRECTION_CHANGE, mark)

    required = REGIME_STRATEGY_MAP.get(pos.strategy)
    if required and current_regime != required:
        return ExitSignal(True, ExitReason.REGIME_INVALIDATED, mark)

    unrealized = (mark - pos.entry_price) / max(pos.entry_price, 0.01)
    if unrealized < -max_position_loss_pct:
        return ExitSignal(True, ExitReason.MAX_RISK, mark)
    if unrealized >= profit_target_pct:
        return ExitSignal(True, ExitReason.PROFIT_TARGET, mark)

    if time_remaining_seconds < settlement_buffer_seconds and net_edge < min_edge * 2:
        return ExitSignal(True, ExitReason.SETTLEMENT_APPROACH, mark)

    if available_liquidity_usd < min_liquidity_usd:
        return ExitSignal(True, ExitReason.LIQUIDITY_DETERIORATED, mark)

    return ExitSignal(False)
