"""Public exchange data collectors for underlying crypto prices."""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import requests


def fetch_binance_ticker(symbol: str = "BTCUSDT") -> dict:
    """Fetch current ticker from Binance public API."""
    url = "https://api.binance.com/api/v3/ticker/bookTicker"
    resp = requests.get(url, params={"symbol": symbol}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return {
        "exchange": "binance",
        "symbol": symbol,
        "bid": float(data["bidPrice"]),
        "ask": float(data["askPrice"]),
        "bid_qty": float(data["bidQty"]),
        "ask_qty": float(data["askQty"]),
        "timestamp": datetime.now(timezone.utc),
    }


def fetch_binance_klines(
    symbol: str = "BTCUSDT",
    interval: str = "1m",
    limit: int = 500,
) -> pd.DataFrame:
    """Fetch historical klines from Binance (public, no auth required)."""
    url = "https://api.binance.com/api/v3/klines"
    resp = requests.get(
        url,
        params={"symbol": symbol, "interval": interval, "limit": limit},
        timeout=30,
    )
    resp.raise_for_status()
    rows = []
    for k in resp.json():
        rows.append(
            {
                "timestamp": pd.Timestamp(k[0], unit="ms", tz="UTC"),
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            }
        )
    return pd.DataFrame(rows)


def klines_to_crypto_snapshots(df: pd.DataFrame, asset: str, exchange: str = "binance") -> pd.DataFrame:
    """Convert kline data to crypto_snapshots schema."""
    df = df.sort_values("timestamp").copy()
    df["return_1m"] = df["close"].pct_change()
    df["return_5m"] = df["close"].pct_change(5)
    df["realized_vol_1h"] = df["return_1m"].rolling(60, min_periods=10).std() * (60**0.5)
    spread_est = df["close"] * 0.0002
    records = []
    for i, row in df.iterrows():
        records.append(
            {
                "exchange": exchange,
                "asset": asset,
                "timestamp": row["timestamp"],
                "spot_price": row["close"],
                "bid": row["close"] - spread_est.loc[i] / 2,
                "ask": row["close"] + spread_est.loc[i] / 2,
                "bid_depth": row["volume"] * 10,
                "ask_depth": row["volume"] * 10,
                "volume_24h": row["volume"] * 1440,
                "return_1m": row["return_1m"] if pd.notna(row["return_1m"]) else 0.0,
                "return_5m": row["return_5m"] if pd.notna(row["return_5m"]) else 0.0,
                "realized_vol_1h": row["realized_vol_1h"] if pd.notna(row["realized_vol_1h"]) else 0.5,
                "order_book_imbalance": 0.0,
            }
        )
    return pd.DataFrame(records)


SYMBOL_MAP = {"BTC": "BTCUSDT", "ETH": "ETHUSDT"}
