"""Transparent baseline fair value probability model."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import norm


def fair_probability_vectorized(
    spot: np.ndarray,
    strike: np.ndarray,
    time_remaining_seconds: np.ndarray,
    realized_vol: np.ndarray,
    momentum: np.ndarray | None = None,
    ob_imbalance: np.ndarray | None = None,
    momentum_weight: float = 0.15,
    imbalance_weight: float = 0.05,
) -> np.ndarray:
    t_years = np.maximum(time_remaining_seconds, 1.0) / (365.25 * 24 * 3600)
    vol = np.maximum(realized_vol, 1e-6)
    d2 = (np.log(spot / strike) + (-0.5 * vol**2) * t_years) / (vol * np.sqrt(t_years))
    base_prob = norm.cdf(d2)
    adj = np.zeros_like(base_prob)
    if momentum is not None:
        adj += momentum_weight * momentum
    if ob_imbalance is not None:
        adj += imbalance_weight * ob_imbalance
    return np.clip(base_prob + adj, 0.001, 0.999)


def fair_probability_row(
    spot: float,
    strike: float,
    time_remaining_seconds: float,
    realized_vol: float,
    momentum: float = 0.0,
    ob_imbalance: float = 0.0,
) -> float:
    return float(
        fair_probability_vectorized(
            np.array([spot]),
            np.array([strike]),
            np.array([time_remaining_seconds]),
            np.array([realized_vol]),
            np.array([momentum]),
            np.array([ob_imbalance]),
        )[0]
    )


def compute_fair_probabilities(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["model_probability"] = fair_probability_vectorized(
        out["spot_price"].values,
        out["strike_price"].values,
        out["time_remaining_seconds"].values,
        out["realized_vol"].values,
        out["momentum"].values if "momentum" in out.columns else None,
        out["ob_imbalance"].values if "ob_imbalance" in out.columns else None,
    )
    out["gross_edge_yes"] = out["model_probability"] - out["executable_yes"]
    out["gross_edge_no"] = (1 - out["model_probability"]) - out["executable_no"]
    return out
