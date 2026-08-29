"""Transparent baseline and adjusted fair-value probability models."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import norm

from pmresearch.regimes.classifier import Regime


def fair_probability_vectorized(
    spot: np.ndarray,
    strike: np.ndarray,
    time_remaining_seconds: np.ndarray,
    realized_vol: np.ndarray,
    momentum: np.ndarray | None = None,
    ob_imbalance: np.ndarray | None = None,
    momentum_weight: float = 0.0,
    imbalance_weight: float = 0.0,
) -> np.ndarray:
    t_years = np.maximum(time_remaining_seconds, 1.0) / (365.25 * 24 * 3600)
    vol = np.maximum(realized_vol, 1e-6)
    d2 = (np.log(spot / strike) + (-0.5 * vol**2) * t_years) / (vol * np.sqrt(t_years))
    base_prob = norm.cdf(d2)
    adj = np.zeros_like(base_prob)
    if momentum is not None and momentum_weight:
        adj += momentum_weight * momentum
    if ob_imbalance is not None and imbalance_weight:
        adj += imbalance_weight * ob_imbalance
    return np.clip(base_prob + adj, 0.001, 0.999)


def compute_baseline_probabilities(df: pd.DataFrame) -> pd.DataFrame:
    """Baseline fair value only — no regime adjustments."""
    out = df.copy()
    vol = out["realized_vol"].values if "realized_vol" in out.columns else out["realized_vol_1h"].fillna(0.5).values
    out["baseline_probability_yes"] = fair_probability_vectorized(
        out["spot_price"].values,
        out["strike_price"].values,
        out["time_remaining_seconds"].values,
        vol,
    )
    out["model_probability"] = out["baseline_probability_yes"]
    return out


def compute_adjusted_probabilities(df: pd.DataFrame) -> pd.DataFrame:
    """Baseline + optional momentum/mean-reversion/order-flow adjustments."""
    out = compute_baseline_probabilities(df)
    adj = np.zeros(len(out))
    regime = out.get("regime", pd.Series(Regime.UNCERTAIN.value, index=out.index))
    z = out.get("return_zscore", pd.Series(0, index=out.index)).fillna(0).values
    persistence = out.get("directional_persistence", pd.Series(0, index=out.index)).fillna(0).values
    ob = out.get("ob_imbalance_regime", out.get("ob_imbalance", pd.Series(0, index=out.index))).fillna(0).values
    mom = out.get("momentum", pd.Series(0, index=out.index)).fillna(0).values

    mr_mask = (regime == Regime.MEAN_REVERTING.value).values
    mom_mask = (regime == Regime.MOMENTUM_TRENDING.value).values

    adj[mr_mask] = -0.03 * np.clip(z[mr_mask], -2, 2)
    if "short_return" in out.columns:
        mom_adj = 0.04 * np.sign(out.loc[mom_mask, "short_return"].fillna(0).values) * np.clip(persistence[mom_mask], 0, 1)
    else:
        mom_adj = 0.04 * np.sign(mom[mom_mask]) * np.clip(persistence[mom_mask], 0, 1)
    adj[mom_mask] = mom_adj
    adj += 0.05 * ob  # order-flow component

    out["regime_adjustment"] = adj
    out["momentum_adjustment"] = 0.15 * mom
    out["adjusted_probability"] = np.clip(out["baseline_probability_yes"] + adj + out["momentum_adjustment"], 0.001, 0.999)
    out["uncertainty_buffer"] = np.where(regime == Regime.UNCERTAIN.value, 0.02, 0.01)
    out["model_probability"] = out["adjusted_probability"]
    return out


def fair_probability_row(
    spot: float, strike: float, time_remaining_seconds: float, realized_vol: float,
    momentum: float = 0.0, ob_imbalance: float = 0.0,
) -> float:
    return float(fair_probability_vectorized(
        np.array([spot]), np.array([strike]), np.array([time_remaining_seconds]),
        np.array([realized_vol]), np.array([momentum]), np.array([ob_imbalance]),
        momentum_weight=0.15, imbalance_weight=0.05,
    )[0])


def compute_fair_probabilities(df: pd.DataFrame) -> pd.DataFrame:
    return compute_adjusted_probabilities(df)
