"""Strategy C — Momentum (MOMENTUM_TRENDING regime only)."""

from __future__ import annotations

import pandas as pd

from pmresearch.regimes.classifier import Regime
from pmresearch.strategies.base import TradeSignal, executable_prices, model_prob, uncertainty_buffer


def generate_signals(
    df: pd.DataFrame,
    min_edge: float = 0.02,
    persistence_threshold: float = 0.5,
    volume_threshold: float = 1.1,
    latency_buffer: float = 0.005,
) -> list[TradeSignal]:
    """Trade when underlying trends but prediction market lags, with measurable edge."""
    signals = []
    mom = df[df["regime"] == Regime.MOMENTUM_TRENDING.value].copy()
    if mom.empty:
        return signals

    if "prob_change" not in mom.columns:
        mom = mom.sort_values(["market_id", "timestamp"])
        mom["prob_change"] = mom.groupby("market_id")["market_probability"].diff().fillna(0)

    for row in mom.itertuples(index=False):
        persistence = getattr(row, "directional_persistence", 0) or 0
        vol_ratio = getattr(row, "volume_ratio", 1) or 1
        ob = getattr(row, "ob_imbalance_regime", 0) or 0
        bo_high = getattr(row, "breakout_high", 0) or 0
        bo_low = getattr(row, "breakout_low", 0) or 0
        short_ret = getattr(row, "short_return", 0) or 0
        prob_chg = getattr(row, "prob_change", 0) or 0
        mp = model_prob(row, use_adjusted=True)
        buf = uncertainty_buffer(row) + latency_buffer
        yes_ask, no_ask, _, _ = executable_prices(row)

        if persistence < persistence_threshold or vol_ratio < volume_threshold:
            continue

        side = None
        entry_reason = ""
        if bo_high and ob > 0.1 and short_ret > 0:
            lag = 0.04 - max(0, prob_chg)
            implied_p = min(0.95, row.market_probability + lag)
            edge = implied_p - yes_ask - buf
            if edge >= min_edge and implied_p > mp * 0.95:
                side, entry_reason = "YES", "mom_breakout_high_lag"
                gross = edge
        elif bo_low and ob < -0.1 and short_ret < 0:
            lag = 0.04 - max(0, -prob_chg)
            implied_p = min(0.95, (1 - row.market_probability) + lag)
            edge = implied_p - no_ask - buf
            if edge >= min_edge:
                side, entry_reason = "NO", "mom_breakout_low_lag"
                gross = edge
        else:
            continue

        if side is None:
            continue
        signals.append(TradeSignal(
            market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
            side=side, gross_edge=gross, model_probability=mp if side == "YES" else 1 - mp,
            strategy="momentum", regime=row.regime,
            confidence=getattr(row, "regime_confidence", 0.5),
            entry_reason=entry_reason,
            duration_minutes=getattr(row, "duration_minutes", 0),
            metadata={"persistence": persistence, "vol_ratio": vol_ratio},
        ))
    return signals
