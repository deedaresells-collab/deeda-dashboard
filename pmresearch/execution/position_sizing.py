"""Adaptive position sizing based on edge, confidence, vol, liquidity, exposure."""

from __future__ import annotations

import numpy as np


def compute_position_size(
    net_edge: float,
    min_edge: float,
    model_confidence: float,
    realized_vol: float,
    available_liquidity_usd: float,
    correlated_exposure_pct: float,
    correlated_limit_pct: float = 0.30,
    base_size_usd: float = 100.0,
    max_size_usd: float = 1000.0,
    target_vol: float = 0.50,
    min_size_usd: float = 10.0,
) -> float:
    """
    Scale position size down when edge is thin, confidence low, vol high,
    liquidity thin, or correlated exposure elevated.
    """
    if net_edge < min_edge or available_liquidity_usd < min_size_usd:
        return 0.0

    edge_factor = np.clip(net_edge / max(min_edge, 1e-6), 0.5, 2.0)
    confidence_factor = np.clip(model_confidence, 0.3, 1.0)
    vol_factor = np.clip(target_vol / max(realized_vol, 0.05), 0.25, 1.5)
    liquidity_cap = available_liquidity_usd * 0.15
    corr_factor = np.clip(1.0 - correlated_exposure_pct / max(correlated_limit_pct, 1e-6), 0.0, 1.0)

    raw = base_size_usd * edge_factor * confidence_factor * vol_factor * corr_factor
    sized = min(raw, liquidity_cap, max_size_usd)
    return float(max(sized, min_size_usd) if sized >= min_size_usd else 0.0)
