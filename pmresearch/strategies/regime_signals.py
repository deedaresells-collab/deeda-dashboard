"""Backward-compatible re-exports from split strategy modules."""

from pmresearch.strategies.base import TradeSignal, executable_prices
from pmresearch.strategies.fair_value import generate_signals as fair_value_signals
from pmresearch.strategies.mean_reversion import generate_signals as mean_reversion_signals
from pmresearch.strategies.momentum import generate_signals as momentum_signals
from pmresearch.strategies.order_flow import generate_signals as order_flow_signals
from pmresearch.strategies.regime_switch import generate_signals as regime_switching_signals

__all__ = [
    "TradeSignal",
    "fair_value_signals",
    "mean_reversion_signals",
    "momentum_signals",
    "order_flow_signals",
    "regime_switching_signals",
]
