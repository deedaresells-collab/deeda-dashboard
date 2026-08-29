"""DuckDB storage layer for historical market data."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS prediction_markets (
    market_id VARCHAR PRIMARY KEY,
    asset VARCHAR NOT NULL,
    duration_minutes INTEGER NOT NULL,
    event VARCHAR,
    settlement_condition VARCHAR,
    strike_price DOUBLE,
    expiration_ts TIMESTAMP NOT NULL,
    settlement_result INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prediction_snapshots (
    snapshot_id BIGINT PRIMARY KEY,
    market_id VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    yes_bid DOUBLE,
    yes_ask DOUBLE,
    no_bid DOUBLE,
    no_ask DOUBLE,
    yes_bid_depth DOUBLE,
    yes_ask_depth DOUBLE,
    no_bid_depth DOUBLE,
    no_ask_depth DOUBLE,
    volume DOUBLE,
    liquidity DOUBLE,
    time_remaining_seconds DOUBLE
);

CREATE TABLE IF NOT EXISTS crypto_snapshots (
    snapshot_id BIGINT PRIMARY KEY,
    exchange VARCHAR NOT NULL,
    asset VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    spot_price DOUBLE,
    bid DOUBLE,
    ask DOUBLE,
    bid_depth DOUBLE,
    ask_depth DOUBLE,
    volume_24h DOUBLE,
    return_1m DOUBLE,
    return_5m DOUBLE,
    realized_vol_1h DOUBLE,
    order_book_imbalance DOUBLE
);

CREATE TABLE IF NOT EXISTS model_predictions (
    prediction_id BIGINT PRIMARY KEY,
    market_id VARCHAR NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    model_probability DOUBLE,
    market_probability DOUBLE,
    gross_edge_yes DOUBLE,
    gross_edge_no DOUBLE,
    spot_price DOUBLE,
    strike_price DOUBLE,
    time_remaining_seconds DOUBLE,
    realized_vol DOUBLE,
    momentum DOUBLE,
    ob_imbalance DOUBLE
);

CREATE TABLE IF NOT EXISTS backtest_trades (
    trade_id BIGINT PRIMARY KEY,
    run_id VARCHAR NOT NULL,
    strategy VARCHAR NOT NULL,
    market_id VARCHAR NOT NULL,
    asset VARCHAR,
    timestamp TIMESTAMP NOT NULL,
    side VARCHAR NOT NULL,
    entry_price DOUBLE,
    exit_price DOUBLE,
    size_usd DOUBLE,
    gross_edge DOUBLE,
    realized_edge DOUBLE,
    fees DOUBLE,
    slippage DOUBLE,
    pnl DOUBLE,
    settlement_result INTEGER,
    time_remaining_seconds DOUBLE,
    parameter_set VARCHAR
);

CREATE TABLE IF NOT EXISTS backtest_runs (
    run_id VARCHAR PRIMARY KEY,
    strategy VARCHAR NOT NULL,
    split VARCHAR NOT NULL,
    parameter_set VARCHAR,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    metrics_json VARCHAR
);

CREATE SEQUENCE IF NOT EXISTS seq_prediction_snapshots START 1;
CREATE SEQUENCE IF NOT EXISTS seq_crypto_snapshots START 1;
CREATE SEQUENCE IF NOT EXISTS seq_model_predictions START 1;
CREATE SEQUENCE IF NOT EXISTS seq_backtest_trades START 1;
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = duckdb.connect(str(self.path))
        self._init_schema()

    def _init_schema(self) -> None:
        for stmt in SCHEMA_SQL.split(";"):
            stmt = stmt.strip()
            if stmt:
                self.conn.execute(stmt)

    def close(self) -> None:
        self.conn.close()

    def execute(self, sql: str, params: list | None = None):
        if params:
            return self.conn.execute(sql, params)
        return self.conn.execute(sql)

    def query_df(self, sql: str, params: list | None = None) -> pd.DataFrame:
        if params:
            return self.conn.execute(sql, params).df()
        return self.conn.execute(sql).df()

    def insert_df(self, table: str, df: pd.DataFrame, replace: bool = False) -> None:
        if df.empty:
            return
        if replace:
            self.conn.execute(f"DELETE FROM {table}")
        self.conn.register("_tmp_df", df)
        cols = ", ".join(df.columns)
        self.conn.execute(f"INSERT INTO {table} ({cols}) SELECT {cols} FROM _tmp_df")
        self.conn.unregister("_tmp_df")

    def upsert_markets(self, df: pd.DataFrame) -> None:
        if df.empty:
            return
        self.conn.register("_markets", df)
        self.conn.execute("DELETE FROM prediction_markets WHERE market_id IN (SELECT market_id FROM _markets)")
        cols = ", ".join(df.columns)
        self.conn.execute(f"INSERT INTO prediction_markets ({cols}) SELECT {cols} FROM _markets")
        self.conn.unregister("_markets")

    def count_rows(self, table: str) -> int:
        return int(self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
