"""Configurable rule-based market regime classifier — no look-ahead."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np
import pandas as pd


class Regime(str, Enum):
    MEAN_REVERTING = "MEAN_REVERTING"
    MOMENTUM_TRENDING = "MOMENTUM_TRENDING"
    UNCERTAIN = "UNCERTAIN"


@dataclass
class RegimeConfig:
    ma_window: int = 20
    atr_window: int = 14
    persistence_window: int = 10
    z_mr_threshold: float = 1.5
    z_mr_high_threshold: float = 2.0
    dist_ma_threshold: float = 0.005
    persistence_mr_max: float = 0.4
    persistence_mom_min: float = 0.55
    volume_ratio_min: float = 1.2
    ob_threshold: float = 0.15
    min_regime_score: float = 0.45
    vol_expansion_window: int = 20


def _rolling_atr(price: pd.Series, window: int = 14) -> pd.Series:
    tr = price.diff().abs()
    return tr.rolling(window, min_periods=max(2, window // 3)).mean()


def compute_regime_features(crypto_df: pd.DataFrame, cfg: RegimeConfig | None = None) -> pd.DataFrame:
    """Compute regime features per asset. Uses only past data."""
    cfg = cfg or RegimeConfig()
    frames = []
    for asset, grp in crypto_df.sort_values("timestamp").groupby("asset"):
        g = grp.copy().reset_index(drop=True)
        price = g["spot_price"]
        ret = price.pct_change().fillna(0)
        w = cfg.ma_window

        g["ma"] = price.rolling(w, min_periods=max(3, w // 4)).mean()
        g["dist_from_ma"] = (price - g["ma"]) / g["ma"].replace(0, np.nan)
        roll_std = ret.rolling(w, min_periods=max(3, w // 4)).std().replace(0, np.nan)
        g["return_zscore"] = ret / roll_std
        g["rolling_return"] = ret.rolling(w, min_periods=3).sum()
        g["realized_vol_regime"] = g.get(
            "realized_vol_1h", ret.rolling(60, min_periods=10).std() * np.sqrt(60)
        ).fillna(0.5)
        g["atr"] = _rolling_atr(price, window=cfg.atr_window)
        g["atr_pct"] = g["atr"] / price.replace(0, np.nan)

        vol_col = "volume_24h" if "volume_24h" in g.columns else None
        if vol_col:
            vol_ma = g[vol_col].rolling(w, min_periods=3).mean().replace(0, np.nan)
            g["volume_ratio"] = g[vol_col] / vol_ma
        else:
            g["volume_ratio"] = 1.0

        g["ob_imbalance_regime"] = g.get("order_book_imbalance", pd.Series(0, index=g.index)).fillna(0)

        roll_high = price.rolling(w, min_periods=3).max().shift(1)
        roll_low = price.rolling(w, min_periods=3).min().shift(1)
        g["breakout_high"] = (price > roll_high).astype(float)
        g["breakout_low"] = (price < roll_low).astype(float)

        sign = np.sign(ret)
        pw = cfg.persistence_window
        persistence = sign.rolling(pw, min_periods=3).apply(lambda x: abs(x.sum()) / len(x), raw=True)
        g["directional_persistence"] = persistence.fillna(0)

        consec = sign.copy()
        consec_pos = (sign > 0).astype(int).groupby((sign <= 0).cumsum()).cumsum()
        consec_neg = (sign < 0).astype(int).groupby((sign >= 0).cumsum()).cumsum()
        g["consecutive_direction"] = np.where(sign >= 0, consec_pos, -consec_neg)

        short_vol = ret.rolling(cfg.vol_expansion_window, min_periods=5).std()
        long_vol = ret.rolling(cfg.vol_expansion_window * 3, min_periods=10).std()
        g["vol_expansion"] = (short_vol / long_vol.replace(0, np.nan)).fillna(1.0)

        g["short_return"] = ret
        frames.append(g)

    return pd.concat(frames, ignore_index=True)


def classify_regime_row(row: pd.Series | dict, cfg: RegimeConfig | None = None) -> tuple[Regime, float]:
    """Transparent rule-based regime classification."""
    cfg = cfg or RegimeConfig()
    if not isinstance(row, dict):
        row = row._asdict() if hasattr(row, "_asdict") else dict(row)

    mr_score = 0.0
    mom_score = 0.0

    z = abs(row.get("return_zscore", 0) or 0)
    dist_ma = abs(row.get("dist_from_ma", 0) or 0)
    persistence = row.get("directional_persistence", 0) or 0
    vol_ratio = row.get("volume_ratio", 1) or 1
    ob = row.get("ob_imbalance_regime", 0) or 0
    bo_high = row.get("breakout_high", 0) or 0
    bo_low = row.get("breakout_low", 0) or 0
    vol_exp = row.get("vol_expansion", 1) or 1
    short_ret = row.get("short_return", 0) or 0

    if z > cfg.z_mr_threshold:
        mr_score += 0.3
    if z > cfg.z_mr_high_threshold:
        mr_score += 0.2
    if dist_ma > cfg.dist_ma_threshold:
        mr_score += 0.2
    if persistence < cfg.persistence_mr_max:
        mr_score += 0.3

    if bo_high or bo_low:
        mom_score += 0.25
    if persistence > cfg.persistence_mom_min:
        mom_score += 0.25
    if vol_ratio > cfg.volume_ratio_min:
        mom_score += 0.15
    if abs(ob) > cfg.ob_threshold:
        mom_score += 0.15
    if (short_ret > 0 and ob > 0) or (short_ret < 0 and ob < 0):
        mom_score += 0.2
    if vol_exp > 1.2:
        mom_score += 0.1

    max_score = max(mr_score, mom_score)
    if max_score < cfg.min_regime_score:
        return Regime.UNCERTAIN, max_score
    if mr_score > mom_score and mr_score >= cfg.min_regime_score:
        return Regime.MEAN_REVERTING, mr_score
    if mom_score > mr_score and mom_score >= cfg.min_regime_score:
        return Regime.MOMENTUM_TRENDING, mom_score
    return Regime.UNCERTAIN, max_score


def classify_regimes(crypto_df: pd.DataFrame, cfg: RegimeConfig | None = None) -> pd.DataFrame:
    """Classify regime for every crypto snapshot."""
    featured = compute_regime_features(crypto_df, cfg)
    regimes, confidences = [], []
    for row in featured.itertuples(index=False):
        r, c = classify_regime_row(row._asdict(), cfg)
        regimes.append(r.value)
        confidences.append(c)
    featured["regime"] = regimes
    featured["regime_confidence"] = confidences
    return featured


REGIME_COLUMNS = [
    "regime", "regime_confidence", "return_zscore", "dist_from_ma",
    "realized_vol_regime", "atr_pct", "volume_ratio", "ob_imbalance_regime",
    "breakout_high", "breakout_low", "directional_persistence", "short_return",
    "baseline_probability", "regime_adjustment", "adjusted_probability",
    "uncertainty_buffer", "prob_change", "vol_expansion", "consecutive_direction",
]


def merge_regime_to_snapshots(df: pd.DataFrame, regime_df: pd.DataFrame) -> pd.DataFrame:
    """ASOF-join regime labels onto prediction snapshots (no look-ahead)."""
    regime_cols = [
        "timestamp", "regime", "regime_confidence",
        "return_zscore", "dist_from_ma", "realized_vol_regime", "atr_pct",
        "volume_ratio", "ob_imbalance_regime", "breakout_high", "breakout_low",
        "directional_persistence", "short_return", "vol_expansion", "consecutive_direction",
    ]
    available = [c for c in regime_cols if c in regime_df.columns]
    drop_cols = [c for c in REGIME_COLUMNS if c in df.columns]
    base = df.drop(columns=drop_cols, errors="ignore")

    parts = []
    for asset, df_asset in base.groupby("asset", sort=False):
        r_asset = regime_df[regime_df["asset"] == asset][available].sort_values("timestamp")
        da = df_asset.sort_values("timestamp")
        parts.append(pd.merge_asof(da, r_asset, on="timestamp", direction="backward"))

    out = pd.concat(parts, ignore_index=True)
    if "regime" not in out.columns:
        out["regime"] = Regime.UNCERTAIN.value
    out["regime"] = out["regime"].fillna(Regime.UNCERTAIN.value)
    out["regime_confidence"] = out.get("regime_confidence", pd.Series(0.0, index=out.index)).fillna(0.0)
    return out
