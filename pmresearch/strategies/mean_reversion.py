"""Strategy B — Mean reversion (MEAN_REVERTING regime only)."""

from __future__ import annotations

import pandas as pd

from pmresearch.regimes.classifier import Regime
from pmresearch.strategies.base import TradeSignal, executable_prices, model_prob, uncertainty_buffer


def generate_signals(
    df: pd.DataFrame,
    min_edge: float = 0.02,
    z_threshold: float = 1.5,
    prob_overshoot_threshold: float = 0.02,
    latency_buffer: float = 0.005,
) -> list[TradeSignal]:
    """Fade prediction-market overshoots when underlying shows mean-reversion conditions."""
    signals = []
    mr = df[df["regime"] == Regime.MEAN_REVERTING.value].copy()
    if mr.empty:
        return signals

    mr = mr.sort_values(["market_id", "timestamp"])
    if "prob_change" not in mr.columns:
        mr["prob_change"] = mr.groupby("market_id")["market_probability"].diff().fillna(0)

    for row in mr.itertuples(index=False):
        z = getattr(row, "return_zscore", 0) or 0
        prob_chg = getattr(row, "prob_change", 0) or 0
        mp = model_prob(row, use_adjusted=True)
        buf = uncertainty_buffer(row) + latency_buffer
        yes_ask, no_ask, _, _ = executable_prices(row)

        side = None
        entry_reason = ""
        gross = 0.0

        if z > z_threshold and prob_chg > prob_overshoot_threshold:
            gross = (1 - mp) - no_ask - buf
            if gross >= min_edge:
                side, entry_reason = "NO", "mr_fade_upside_overshoot"
        elif z < -z_threshold and prob_chg < -prob_overshoot_threshold:
            gross = mp - yes_ask - buf
            if gross >= min_edge:
                side, entry_reason = "YES", "mr_fade_downside_overshoot"

        if side is None:
            continue

        signals.append(TradeSignal(
            market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
            side=side, gross_edge=gross, model_probability=mp if side == "YES" else 1 - mp,
            strategy="mean_reversion", regime=row.regime,
            confidence=getattr(row, "regime_confidence", 0.5),
            entry_reason=entry_reason,
            duration_minutes=getattr(row, "duration_minutes", 0),
            metadata={"z_score": z, "prob_change": prob_chg},
        ))
    return signals
