"""Feature engineering for fair value and strategy signals."""

from __future__ import annotations

import numpy as np
import pandas as pd


def compute_momentum(df: pd.DataFrame, col: str = "return_5m", weight: float = 0.5) -> pd.Series:
    return df[col].fillna(0) * weight


def compute_time_decay_factor(time_remaining_seconds: pd.Series, duration_seconds: float) -> pd.Series:
    t = time_remaining_seconds.clip(lower=1)
    return np.sqrt(t / duration_seconds)


def add_fair_value_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add derived features used by the fair value model."""
    out = df.copy()
    out["momentum"] = compute_momentum(out)
    out["log_moneyness"] = np.log(out["spot_price"] / out["strike_price"].clip(lower=1e-8))
    out["realized_vol"] = out["realized_vol_1h"].fillna(out["realized_vol_1h"].median()).clip(lower=1e-6)
    out["ob_imbalance"] = out["order_book_imbalance"].fillna(0)
    out["market_probability"] = (out["yes_bid"] + out["yes_ask"]) / 2
    out["executable_yes"] = out["yes_ask"]
    out["executable_no"] = out["no_ask"]
    return out
