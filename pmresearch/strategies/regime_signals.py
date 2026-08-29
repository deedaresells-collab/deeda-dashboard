"""Strategy signals — mean reversion, momentum, fair value, order flow."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from pmresearch.features.regime import Regime


@dataclass
class TradeSignal:
    market_id: str
    asset: str
    timestamp: object
    side: str  # YES or NO
    gross_edge: float
    model_probability: float
    strategy: str
    regime: str
    confidence: float
    metadata: dict


def _executable_prices(row) -> tuple[float, float, float, float]:
    yes_ask = row.executable_yes if hasattr(row, "executable_yes") else row.yes_ask
    no_ask = row.executable_no if hasattr(row, "executable_no") else row.no_ask
    yes_depth = row.yes_ask_depth
    no_depth = row.no_ask_depth
    return yes_ask, no_ask, yes_depth, no_depth


def mean_reversion_signals(
    df: pd.DataFrame,
    z_threshold: float = 1.5,
    prob_overshoot_threshold: float = 0.02,
    min_edge: float = 0.02,
) -> list[TradeSignal]:
    """
    In MEAN_REVERTING regime: fade prediction-market probability overshoots
    following extreme underlying moves.
    """
    signals = []
    mr = df[df["regime"] == Regime.MEAN_REVERTING.value].copy()
    if mr.empty:
        return signals

    mr = mr.sort_values(["market_id", "timestamp"])
    mr["prob_change"] = mr.groupby("market_id")["market_probability"].diff().fillna(0)

    for row in mr.itertuples(index=False):
        z = getattr(row, "return_zscore", 0) or 0
        prob_chg = getattr(row, "prob_change", 0) or 0
        if abs(z) < z_threshold:
            continue

        # Overshoot: underlying z positive + prob spiked up -> fade (buy NO)
        #            underlying z negative + prob dropped -> fade (buy YES)
        if z > z_threshold and prob_chg > prob_overshoot_threshold:
            side = "NO"
            model_p = 1 - min(0.95, row.market_probability + 0.05)
            yes_ask, no_ask, _, _ = _executable_prices(row)
            gross_edge = (1 - model_p) - no_ask
        elif z < -z_threshold and prob_chg < -prob_overshoot_threshold:
            side = "YES"
            model_p = max(0.05, row.market_probability - 0.05)
            yes_ask, no_ask, _, _ = _executable_prices(row)
            gross_edge = model_p - yes_ask
        else:
            continue

        if gross_edge < min_edge:
            continue

        signals.append(TradeSignal(
            market_id=row.market_id,
            asset=row.asset,
            timestamp=row.timestamp,
            side=side,
            gross_edge=gross_edge,
            model_probability=model_p if side == "YES" else 1 - model_p,
            strategy="mean_reversion",
            regime=row.regime,
            confidence=row.regime_confidence,
            metadata={"z_score": z, "prob_change": prob_chg},
        ))
    return signals


def momentum_signals(
    df: pd.DataFrame,
    persistence_threshold: float = 0.5,
    volume_threshold: float = 1.1,
    min_edge: float = 0.02,
) -> list[TradeSignal]:
    """
    In MOMENTUM_TRENDING regime: trade when underlying breaks out with
    volume/OB confirmation but prediction market lags.
    """
    signals = []
    mom = df[df["regime"] == Regime.MOMENTUM_TRENDING.value].copy()
    if mom.empty:
        return signals

    for row in mom.itertuples(index=False):
        bo_high = getattr(row, "breakout_high", 0) or 0
        bo_low = getattr(row, "breakout_low", 0) or 0
        persistence = getattr(row, "directional_persistence", 0) or 0
        vol_ratio = getattr(row, "volume_ratio", 1) or 1
        ob = getattr(row, "ob_imbalance_regime", 0) or 0
        short_ret = getattr(row, "short_return", 0) or 0

        if persistence < persistence_threshold or vol_ratio < volume_threshold:
            continue

        side = None
        if bo_high and ob > 0.1 and short_ret > 0:
            side = "YES"
            expected_shift = 0.04
            lag = expected_shift - max(0, getattr(row, "prob_change", 0) or 0)
            model_p = min(0.95, row.market_probability + lag)
            yes_ask, _, _, _ = _executable_prices(row)
            gross_edge = model_p - yes_ask
        elif bo_low and ob < -0.1 and short_ret < 0:
            side = "NO"
            expected_shift = 0.04
            lag = expected_shift - max(0, -(getattr(row, "prob_change", 0) or 0))
            model_p = 1 - min(0.95, (1 - row.market_probability) + lag)
            _, no_ask, _, _ = _executable_prices(row)
            gross_edge = model_p - no_ask
        else:
            continue

        if side is None or gross_edge < min_edge:
            continue

        signals.append(TradeSignal(
            market_id=row.market_id,
            asset=row.asset,
            timestamp=row.timestamp,
            side=side,
            gross_edge=gross_edge,
            model_probability=model_p,
            strategy="momentum",
            regime=row.regime,
            confidence=row.regime_confidence,
            metadata={"persistence": persistence, "vol_ratio": vol_ratio, "ob": ob},
        ))
    return signals


def fair_value_signals(
    df: pd.DataFrame,
    min_edge: float = 0.03,
    use_adjusted: bool = True,
) -> list[TradeSignal]:
    """Base fair value with optional regime adjustment."""
    signals = []
    prob_col = "adjusted_probability" if use_adjusted and "adjusted_probability" in df.columns else "model_probability"
    buffer_col = "uncertainty_buffer" if "uncertainty_buffer" in df.columns else None

    for row in df.itertuples(index=False):
        model_p = getattr(row, prob_col, None) or getattr(row, "model_probability", 0.5)
        buffer = getattr(row, buffer_col, 0.01) if buffer_col else 0.01
        yes_ask, no_ask, _, _ = _executable_prices(row)

        edge_yes = model_p - yes_ask - buffer
        edge_no = (1 - model_p) - no_ask - buffer

        if edge_yes >= min_edge:
            signals.append(TradeSignal(
                market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
                side="YES", gross_edge=edge_yes, model_probability=model_p,
                strategy="fair_value", regime=getattr(row, "regime", "UNCERTAIN"),
                confidence=getattr(row, "regime_confidence", 0.5),
                metadata={"buffer": buffer},
            ))
        elif edge_no >= min_edge:
            signals.append(TradeSignal(
                market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
                side="NO", gross_edge=edge_no, model_probability=1 - model_p,
                strategy="fair_value", regime=getattr(row, "regime", "UNCERTAIN"),
                confidence=getattr(row, "regime_confidence", 0.5),
                metadata={"buffer": buffer},
            ))
    return signals


def order_flow_signals(
    df: pd.DataFrame,
    ob_threshold: float = 0.20,
    min_edge: float = 0.02,
) -> list[TradeSignal]:
    """
    Order-flow only: trade when OB imbalance diverges from market probability direction.
    No regime filter — tests order flow in isolation.
    """
    signals = []
    for row in df.itertuples(index=False):
        ob = getattr(row, "ob_imbalance_regime", None) or getattr(row, "ob_imbalance", 0) or 0
        if abs(ob) < ob_threshold:
            continue

        yes_ask, no_ask, _, _ = _executable_prices(row)
        if ob > ob_threshold:
            model_p = min(0.90, row.market_probability + abs(ob) * 0.1)
            edge = model_p - yes_ask
            side = "YES"
        else:
            model_p = min(0.90, (1 - row.market_probability) + abs(ob) * 0.1)
            edge = model_p - no_ask
            side = "NO"

        if edge < min_edge:
            continue

        signals.append(TradeSignal(
            market_id=row.market_id, asset=row.asset, timestamp=row.timestamp,
            side=side, gross_edge=edge, model_probability=model_p,
            strategy="order_flow", regime=getattr(row, "regime", "UNCERTAIN"),
            confidence=min(abs(ob), 1.0),
            metadata={"ob_imbalance": ob},
        ))
    return signals


def regime_switching_signals(df: pd.DataFrame, min_edge: float = 0.02) -> list[TradeSignal]:
    """Route to appropriate strategy based on current regime."""
    signals = []
    signals.extend(mean_reversion_signals(df, min_edge=min_edge))
    signals.extend(momentum_signals(df, min_edge=min_edge))
    # Fair value only in UNCERTAIN regime
    uncertain = df[df["regime"] == Regime.UNCERTAIN.value]
    if not uncertain.empty:
        signals.extend(fair_value_signals(uncertain, min_edge=min_edge + 0.01, use_adjusted=True))
    return signals
