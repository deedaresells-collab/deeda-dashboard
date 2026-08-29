"""Correlated portfolio exposure tracking."""

from __future__ import annotations

from dataclasses import dataclass, field

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
    side: str
    entry_price: float
    size_usd: float
    entry_timestamp: object
    strategy: str
    regime_at_entry: str
    model_probability: float
    time_remaining_seconds: float
    duration_minutes: int = 0
    entry_reason: str = ""
    predicted_edge: float = 0.0
    settlement_result: int | None = None


@dataclass
class RiskLimits:
    max_position_risk_pct: float = 0.15
    max_asset_exposure_pct: float = 0.25
    max_directional_crypto_exposure_pct: float = 0.30
    max_total_portfolio_exposure_pct: float = 0.50
    correlated_exposure_limit_pct: float = 0.30


@dataclass
class ExposureState:
    positions: list[OpenPosition] = field(default_factory=list)
    limits: RiskLimits = field(default_factory=RiskLimits)

    def total_exposure(self) -> float:
        return sum(p.size_usd for p in self.positions)

    def asset_exposure(self, asset: str) -> float:
        return sum(p.size_usd for p in self.positions if p.asset == asset)

    def directional_exposure(self, side: str) -> float:
        return sum(p.size_usd for p in self.positions if p.side == side)

    def asset_direction_exposure(self, asset: str, side: str) -> float:
        return sum(p.size_usd for p in self.positions if p.asset == asset and p.side == side)

    def overlapping_asset_exposure(self, asset: str) -> float:
        """Aggregate across all expirations for same underlying."""
        return self.asset_exposure(asset)

    def correlated_exposure(self, asset: str, side: str, portfolio_value: float) -> float:
        if portfolio_value <= 0:
            return 0.0
        correlated = self.asset_direction_exposure(asset, side)
        for other in {p.asset for p in self.positions} - {asset}:
            corr = DEFAULT_CORRELATIONS.get(tuple(sorted([asset, other])), 0.5)
            correlated += self.asset_direction_exposure(other, side) * corr
        return correlated / portfolio_value

    def can_add(self, asset: str, side: str, size_usd: float, portfolio_value: float) -> bool:
        if portfolio_value <= 0:
            return False
        lim = self.limits
        new_total = (self.total_exposure() + size_usd) / portfolio_value
        new_asset = (self.asset_exposure(asset) + size_usd) / portfolio_value
        new_dir = (self.directional_exposure(side) + size_usd) / portfolio_value
        new_corr = self.correlated_exposure(asset, side, portfolio_value) + size_usd / portfolio_value
        return (
            new_total <= lim.max_total_portfolio_exposure_pct
            and new_asset <= lim.max_asset_exposure_pct
            and new_dir <= lim.max_directional_crypto_exposure_pct
            and new_corr <= lim.correlated_exposure_limit_pct
        )

    def add(self, pos: OpenPosition) -> None:
        self.positions.append(pos)

    def remove(self, position_id: str) -> OpenPosition | None:
        for i, p in enumerate(self.positions):
            if p.position_id == position_id:
                return self.positions.pop(i)
        return None
