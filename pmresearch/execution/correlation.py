"""Correlation engine — aggregate exposure across correlated positions."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Static correlation estimates (crypto majors). Not future-looking.
DEFAULT_CORRELATIONS: dict[tuple[str, str], float] = {
    ("BTC", "ETH"): 0.82,
    ("BTC", "SOL"): 0.75,
    ("ETH", "SOL"): 0.78,
}


@dataclass
class OpenPosition:
    position_id: str
    market_id: str
    asset: str
    side: str  # YES or NO
    entry_price: float
    size_usd: float
    entry_timestamp: object
    strategy: str
    regime_at_entry: str
    model_probability: float
    time_remaining_seconds: float
    settlement_result: int | None = None


@dataclass
class ExposureState:
    positions: list[OpenPosition] = field(default_factory=list)
    asset_exposure: dict[str, float] = field(default_factory=dict)
    direction_exposure: dict[str, float] = field(default_factory=dict)

    def total_exposure(self) -> float:
        return sum(p.size_usd for p in self.positions)

    def asset_direction_exposure(self, asset: str, side: str) -> float:
        return sum(p.size_usd for p in self.positions if p.asset == asset and p.side == side)

    def correlated_exposure(self, asset: str, side: str, portfolio_value: float) -> float:
        """Weighted correlated exposure for a proposed trade."""
        if portfolio_value <= 0:
            return 0.0
        direct = self.asset_direction_exposure(asset, side)
        correlated = direct
        for other_asset, exp in self.asset_exposure.items():
            if other_asset == asset:
                continue
            corr = DEFAULT_CORRELATIONS.get(
                tuple(sorted([asset, other_asset])),
                0.5,
            )
            other_side_exp = sum(
                p.size_usd for p in self.positions
                if p.asset == other_asset and p.side == side
            )
            correlated += other_side_exp * corr
        return correlated / portfolio_value

    def can_add(
        self,
        asset: str,
        side: str,
        size_usd: float,
        portfolio_value: float,
        correlated_limit_pct: float = 0.30,
        per_asset_limit_pct: float = 0.25,
    ) -> bool:
        if portfolio_value <= 0:
            return False
        new_corr = self.correlated_exposure(asset, side, portfolio_value) + size_usd / portfolio_value
        new_asset = (self.asset_exposure.get(asset, 0) + size_usd) / portfolio_value
        return new_corr <= correlated_limit_pct and new_asset <= per_asset_limit_pct

    def add(self, pos: OpenPosition) -> None:
        self.positions.append(pos)
        self.asset_exposure[pos.asset] = self.asset_exposure.get(pos.asset, 0) + pos.size_usd
        key = f"{pos.asset}_{pos.side}"
        self.direction_exposure[key] = self.direction_exposure.get(key, 0) + pos.size_usd

    def remove(self, position_id: str) -> OpenPosition | None:
        for i, p in enumerate(self.positions):
            if p.position_id == position_id:
                self.positions.pop(i)
                self.asset_exposure[p.asset] = max(0, self.asset_exposure.get(p.asset, 0) - p.size_usd)
                key = f"{p.asset}_{p.side}"
                self.direction_exposure[key] = max(0, self.direction_exposure.get(key, 0) - p.size_usd)
                return p
        return None

    def exposure_by_asset(self) -> dict[str, float]:
        return dict(self.asset_exposure)
