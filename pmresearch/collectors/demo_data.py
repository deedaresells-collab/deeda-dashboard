"""Synthetic demo data generator for pipeline testing.

WARNING: This generates clearly labeled synthetic data for development and
pipeline validation only. Do NOT treat results from this data as evidence of
a real trading edge. Real backtests require imported historical order-book data.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd
from scipy.stats import norm

from pmresearch.data.storage import Database


def generate_demo_dataset(
    db: Database,
    n_days: int = 14,
    snapshot_interval_seconds: int = 60,
    seed: int = 42,
    assets: list[str] | None = None,
    durations: list[int] | None = None,
) -> dict[str, int]:
    """Generate synthetic but internally consistent demo data (vectorized)."""
    assets = assets or ["BTC", "ETH"]
    durations = durations or [5, 15, 60]
    rng = np.random.default_rng(seed)

    start = pd.Timestamp("2025-01-01", tz="UTC")
    end = start + timedelta(days=n_days)
    timestamps = pd.date_range(start, end, freq=f"{snapshot_interval_seconds}s", tz="UTC")
    n_steps = len(timestamps)
    dt = snapshot_interval_seconds / (365.25 * 24 * 3600)

    s0_map = {"BTC": 95000.0, "ETH": 3400.0}
    sigma_map = {"BTC": 0.55, "ETH": 0.65}

    crypto_rows = []
    markets_rows = []
    pred_rows = []
    crypto_counter = 1
    snap_counter = 1
    market_counter = 0

    for asset in assets:
        s0 = s0_map[asset]
        sigma = sigma_map[asset]
        shocks = rng.standard_normal(n_steps)
        log_returns = (0.05 - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * shocks
        prices = s0 * np.exp(np.cumsum(log_returns))

        ret_series = pd.Series(prices).pct_change().fillna(0)
        vol_window = max(10, 3600 // snapshot_interval_seconds)
        vol_1h = ret_series.rolling(vol_window, min_periods=5).std() * np.sqrt(vol_window)
        vol_1h = vol_1h.fillna(sigma / np.sqrt(365.25 * 24))

        spread_bps = rng.uniform(1, 5, n_steps)
        half_spread = prices * spread_bps / 10000 / 2
        depth = rng.uniform(50000, 500000, n_steps)
        ob_imb = rng.uniform(-0.3, 0.3, n_steps)

        crypto_df = pd.DataFrame({
            "snapshot_id": range(crypto_counter, crypto_counter + n_steps),
            "exchange": "binance",
            "asset": asset,
            "timestamp": timestamps,
            "spot_price": prices,
            "bid": prices - half_spread,
            "ask": prices + half_spread,
            "bid_depth": depth * (0.5 + ob_imb / 2),
            "ask_depth": depth * (0.5 - ob_imb / 2),
            "volume_24h": depth * 10,
            "return_1m": ret_series.values,
            "return_5m": ret_series.rolling(min(5, vol_window), min_periods=1).sum().values,
            "realized_vol_1h": vol_1h.values,
            "order_book_imbalance": ob_imb,
        })
        crypto_rows.append(crypto_df)
        crypto_counter += n_steps

        for duration in durations:
            duration_seconds = duration * 60
            n_snaps = duration_seconds // snapshot_interval_seconds
            step = max(1, n_snaps // 2)
            starts = range(0, n_steps - n_snaps, step)

            for start_idx in starts:
                end_idx = start_idx + n_snaps
                open_ts = timestamps[start_idx]
                exp_ts = open_ts + timedelta(minutes=duration)
                strike = prices[start_idx]
                final_price = prices[end_idx]
                settlement = 1 if final_price >= strike else 0
                market_id = f"DEMO-{asset}-{duration}m-{market_counter:05d}"
                market_counter += 1

                markets_rows.append({
                    "market_id": market_id,
                    "asset": asset,
                    "duration_minutes": duration,
                    "event": f"{asset} above {strike:.2f} at expiry",
                    "settlement_condition": "YES if spot >= strike at expiration",
                    "strike_price": strike,
                    "expiration_ts": exp_ts,
                    "settlement_result": settlement,
                })

                idx_slice = np.arange(start_idx, end_idx + 1)
                ts_slice = timestamps[idx_slice]
                spot_slice = prices[idx_slice]
                vol_slice = vol_1h.iloc[idx_slice].values
                ret_slice = ret_series.iloc[idx_slice].values
                t_rem = np.array([(exp_ts - t).total_seconds() for t in ts_slice])

                t_years = np.maximum(t_rem, 1.0) / (365.25 * 24 * 3600)
                vol_safe = np.maximum(vol_slice, 1e-6)
                d2 = (np.log(spot_slice / strike) + (-0.5 * vol_safe**2) * t_years) / (vol_safe * np.sqrt(t_years))
                fair_prob = norm.cdf(d2)
                lag_noise = rng.normal(0, 0.03, len(idx_slice))
                momentum_adj = -0.15 * ret_slice
                market_mid = np.clip(fair_prob + lag_noise + momentum_adj, 0.02, 0.98)
                m_spread = rng.uniform(0.01, 0.04, len(idx_slice))
                yes_bid = np.clip(market_mid - m_spread / 2, 0.01, 0.98)
                yes_ask = np.clip(market_mid + m_spread / 2, 0.02, 0.99)
                no_bid = np.clip(1 - yes_ask - rng.uniform(0, 0.02, len(idx_slice)), 0.01, 0.98)
                no_ask = np.clip(1 - yes_bid + rng.uniform(0, 0.02, len(idx_slice)), 0.02, 0.99)
                liq = rng.uniform(100, 5000, len(idx_slice))

                pred_rows.append(pd.DataFrame({
                    "snapshot_id": range(snap_counter, snap_counter + len(idx_slice)),
                    "market_id": market_id,
                    "timestamp": ts_slice,
                    "yes_bid": yes_bid,
                    "yes_ask": yes_ask,
                    "no_bid": no_bid,
                    "no_ask": no_ask,
                    "yes_bid_depth": liq / np.maximum(yes_bid, 0.01),
                    "yes_ask_depth": liq / np.maximum(yes_ask, 0.01),
                    "no_bid_depth": liq / np.maximum(no_bid, 0.01),
                    "no_ask_depth": liq / np.maximum(no_ask, 0.01),
                    "volume": rng.uniform(10, 500, len(idx_slice)),
                    "liquidity": liq,
                    "time_remaining_seconds": t_rem,
                }))
                snap_counter += len(idx_slice)

    markets_df = pd.DataFrame(markets_rows)
    pred_df = pd.concat(pred_rows, ignore_index=True) if pred_rows else pd.DataFrame()
    crypto_df = pd.concat(crypto_rows, ignore_index=True)

    for table in ["backtest_trades", "backtest_runs", "model_predictions", "prediction_snapshots", "crypto_snapshots", "prediction_markets"]:
        db.execute(f"DELETE FROM {table}")

    db.upsert_markets(markets_df)
    db.insert_df("prediction_snapshots", pred_df)
    db.insert_df("crypto_snapshots", crypto_df)

    return {
        "markets": len(markets_df),
        "prediction_snapshots": len(pred_df),
        "crypto_snapshots": len(crypto_df),
        "data_type": "SYNTHETIC_DEMO",
    }
