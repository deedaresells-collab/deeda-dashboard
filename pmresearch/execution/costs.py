"""Realistic execution cost and fill modeling."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExecutionResult:
    filled: bool
    fill_price: float
    fill_size_usd: float
    fees: float
    slippage: float
    partial: bool


def compute_fees(size_usd: float, fee_pct: float) -> float:
    return size_usd * fee_pct


def compute_slippage(size_usd: float, available_liquidity: float, slippage_bps: float) -> float:
    if available_liquidity <= 0:
        return size_usd
    utilization = min(size_usd / available_liquidity, 1.0)
    return size_usd * (slippage_bps / 10000) * (1 + utilization * 2)


def simulate_market_order(
    side: str,
    size_usd: float,
    yes_ask: float,
    no_ask: float,
    yes_ask_depth: float,
    no_ask_depth: float,
    fee_pct: float,
    slippage_bps: float,
    min_liquidity: float = 50.0,
) -> ExecutionResult:
    """Simulate aggressive (taker) fill at ask with liquidity constraints."""
    if side == "YES":
        ask = yes_ask
        depth_usd = yes_ask_depth * yes_ask if yes_ask > 0 else yes_ask_depth
    else:
        ask = no_ask
        depth_usd = no_ask_depth * no_ask if no_ask > 0 else no_ask_depth

    if depth_usd < min_liquidity or ask <= 0 or ask >= 1:
        return ExecutionResult(False, 0.0, 0.0, 0.0, 0.0, False)

    fill_size = min(size_usd, depth_usd)
    partial = fill_size < size_usd
    slip = compute_slippage(fill_size, depth_usd, slippage_bps)
    slip_price = (slippage_bps / 10000) * (1 + fill_size / max(depth_usd, 1))
    fill_price = min(ask + slip_price, 0.99)
    fees = compute_fees(fill_size, fee_pct)
    return ExecutionResult(True, fill_price, fill_size, fees, slip, partial)


def simulate_passive_fill(
    side: str,
    quote_price: float,
    size_usd: float,
    market_mid: float,
    underlying_move_pct: float,
    available_depth: float,
    cancel_latency_seconds: float = 0.5,
    adverse_threshold: float = 0.001,
) -> ExecutionResult:
    """
    Passive fill with adverse selection: if underlying moved significantly
    before cancel, stale quote may fill adversely.
    """
    move = abs(underlying_move_pct)
    if side == "BID":
        # Bid gets hit if market drops toward us (we're buying cheap before further drop)
        adverse = underlying_move_pct < -adverse_threshold and quote_price >= market_mid - 0.02
        fill_prob = 0.15 + 0.5 * min(move / adverse_threshold, 1.0) if adverse else 0.05
    else:
        adverse = underlying_move_pct > adverse_threshold and quote_price <= market_mid + 0.02
        fill_prob = 0.15 + 0.5 * min(move / adverse_threshold, 1.0) if adverse else 0.05

    import random

    if random.random() > fill_prob:
        return ExecutionResult(False, 0.0, 0.0, 0.0, 0.0, False)

    fill_size = min(size_usd, available_depth * quote_price)
    if fill_size < 10:
        return ExecutionResult(False, 0.0, 0.0, 0.0, 0.0, False)
    return ExecutionResult(True, quote_price, fill_size, fill_size * 0.001, 0.0, fill_size < size_usd)
