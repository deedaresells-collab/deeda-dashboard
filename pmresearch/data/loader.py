"""Data loading and alignment utilities."""

from __future__ import annotations

import pandas as pd

from pmresearch.data.storage import Database


def load_merged_snapshots(db: Database) -> pd.DataFrame:
    """Load prediction snapshots merged with nearest prior crypto data (no look-ahead)."""
    sql = """
    WITH crypto AS (
        SELECT
            asset,
            timestamp AS crypto_ts,
            exchange,
            spot_price,
            bid AS crypto_bid,
            ask AS crypto_ask,
            bid_depth,
            ask_depth,
            return_1m,
            return_5m,
            realized_vol_1h,
            order_book_imbalance
        FROM crypto_snapshots
    ),
    pred AS (
        SELECT
            ps.*,
            pm.asset,
            pm.duration_minutes,
            pm.strike_price,
            pm.expiration_ts,
            pm.settlement_result,
            pm.event
        FROM prediction_snapshots ps
        JOIN prediction_markets pm ON ps.market_id = pm.market_id
    )
    SELECT
        p.*,
        c.crypto_ts,
        c.exchange,
        c.spot_price,
        c.crypto_bid,
        c.crypto_ask,
        c.bid_depth,
        c.ask_depth,
        c.return_1m,
        c.return_5m,
        c.realized_vol_1h,
        c.order_book_imbalance,
        EXTRACT(EPOCH FROM (p.timestamp - c.crypto_ts)) AS crypto_lag_seconds
    FROM pred p
    ASOF JOIN crypto c
        ON p.asset = c.asset AND p.timestamp >= c.crypto_ts
    ORDER BY p.timestamp
    """
    return db.query_df(sql)


def load_settled_markets(db: Database) -> pd.DataFrame:
    return db.query_df("""
        SELECT * FROM prediction_markets
        WHERE settlement_result IS NOT NULL
        ORDER BY expiration_ts
    """)


def load_predictions(db: Database) -> pd.DataFrame:
    return db.query_df("SELECT * FROM model_predictions ORDER BY timestamp")


def chronological_split(
    df: pd.DataFrame,
    ts_col: str = "timestamp",
    train_pct: float = 0.60,
    val_pct: float = 0.20,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split dataframe chronologically into train/validation/test."""
    df = df.sort_values(ts_col).reset_index(drop=True)
    n = len(df)
    train_end = int(n * train_pct)
    val_end = int(n * (train_pct + val_pct))
    train = df.iloc[:train_end].copy()
    val = df.iloc[train_end:val_end].copy()
    test = df.iloc[val_end:].copy()
    return train, val, test
