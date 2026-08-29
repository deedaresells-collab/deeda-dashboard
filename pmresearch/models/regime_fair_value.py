"""Regime-adjusted fair value probability model."""

from __future__ import annotations

import numpy as np
import pandas as pd

from pmresearch.features.regime import Regime
from pmresearch.models.fair_value import fair_probability_vectorized


def regime_adjusted_probability(df: pd.DataFrame) -> pd.DataFrame:
    """
    Baseline fair value + regime-specific adjustments.
    UNCERTAIN regime adds uncertainty buffer requirement (stored separately).
    """
    out = df.copy()
    baseline = fair_probability_vectorized(
        out["spot_price"].values,
        out["strike_price"].values,
        out["time_remaining_seconds"].values,
        out["realized_vol"].values if "realized_vol" in out.columns else out["realized_vol_1h"].fillna(0.5).values,
        out["momentum"].values if "momentum" in out.columns else None,
        out["ob_imbalance"].values if "ob_imbalance" in out.columns else None,
    )
    out["baseline_probability"] = baseline

    adj = np.zeros(len(out))
    regime = out.get("regime", pd.Series(Regime.UNCERTAIN.value, index=out.index))

    mr_mask = regime == Regime.MEAN_REVERTING.value
    mom_mask = regime == Regime.MOMENTUM_TRENDING.value

    z = out.get("return_zscore", pd.Series(0, index=out.index)).fillna(0).values
    persistence = out.get("directional_persistence", pd.Series(0, index=out.index)).fillna(0).values

    # Mean reversion: fade extreme z-scores
    adj[mr_mask.values] = -0.03 * np.clip(z[mr_mask.values], -2, 2)

    # Momentum: amplify direction
    mom_adj = 0.04 * np.sign(out.loc[mom_mask, "short_return"].fillna(0).values) * np.clip(persistence[mom_mask.values], 0, 1)
    adj[mom_mask.values] = mom_adj

    out["regime_adjustment"] = adj
    out["adjusted_probability"] = np.clip(baseline + adj, 0.001, 0.999)
    out["uncertainty_buffer"] = np.where(
        regime == Regime.UNCERTAIN.value, 0.02, 0.01
    )
    return out
