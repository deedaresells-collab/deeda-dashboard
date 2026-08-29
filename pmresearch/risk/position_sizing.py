"""Position sizing methods."""

from __future__ import annotations

from enum import Enum

import numpy as np


class PositionSizingMethod(str, Enum):
    FIXED_SIZE = "FIXED_SIZE"
    FIXED_FRACTION = "FIXED_FRACTION"
    EDGE_WEIGHTED = "EDGE_WEIGHTED"


def compute_position_size(
    method: PositionSizingMethod,
    net_edge: float,
    min_edge: float,
    model_confidence: float,
    realized_vol: float,
    available_liquidity_usd: float,
    correlated_exposure_pct: float,
    portfolio_value: float,
    base_size_usd: float = 100.0,
    max_size_usd: float = 1000.0,
    fixed_fraction: float = 0.01,
    target_vol: float = 0.50,
    min_size_usd: float = 10.0,
    correlated_limit_pct: float = 0.30,
) -> float:
    """Compute position size. No unrestricted Kelly sizing."""
    if net_edge < min_edge or available_liquidity_usd < min_size_usd:
        return 0.0

    liquidity_cap = available_liquidity_usd * 0.15
    corr_factor = np.clip(1.0 - correlated_exposure_pct / max(correlated_limit_pct, 1e-6), 0.0, 1.0)

    if method == PositionSizingMethod.FIXED_SIZE:
        raw = base_size_usd
    elif method == PositionSizingMethod.FIXED_FRACTION:
        raw = portfolio_value * fixed_fraction
    else:  # EDGE_WEIGHTED
        edge_factor = np.clip(net_edge / max(min_edge, 1e-6), 0.5, 2.0)
        confidence_factor = np.clip(model_confidence, 0.3, 1.0)
        vol_factor = np.clip(target_vol / max(realized_vol, 0.05), 0.25, 1.5)
        raw = base_size_usd * edge_factor * confidence_factor * vol_factor

    sized = min(raw * corr_factor, liquidity_cap, max_size_usd)
    return float(sized if sized >= min_size_usd else 0.0)
