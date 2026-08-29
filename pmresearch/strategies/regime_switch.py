"""Strategy E — Regime switch router."""

from __future__ import annotations

import pandas as pd

from pmresearch.regimes.classifier import Regime
from pmresearch.strategies.base import TradeSignal
from pmresearch.strategies.fair_value import generate_signals as fair_value_signals
from pmresearch.strategies.mean_reversion import generate_signals as mean_reversion_signals
from pmresearch.strategies.momentum import generate_signals as momentum_signals


def generate_signals(
    df: pd.DataFrame,
    min_edge: float = 0.02,
    uncertain_mode: str = "fair_value",  # "fair_value" or "no_trade"
    **kwargs,
) -> list[TradeSignal]:
    """Route to appropriate strategy based on regime."""
    signals: list[TradeSignal] = []
    signals.extend(mean_reversion_signals(df, min_edge=min_edge, **kwargs))
    signals.extend(momentum_signals(df, min_edge=min_edge, **kwargs))

    if uncertain_mode == "fair_value":
        uncertain = df[df["regime"] == Regime.UNCERTAIN.value]
        if not uncertain.empty:
            signals.extend(fair_value_signals(uncertain, min_edge=min_edge + 0.01, use_adjusted=True))

    for s in signals:
        s.strategy = "regime_switch"
    return signals
