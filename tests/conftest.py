"""Pytest configuration."""

import tempfile
from pathlib import Path

import pytest

from pmresearch.collectors.demo_data import generate_demo_dataset
from pmresearch.data.storage import Database


@pytest.fixture
def temp_db():
    with tempfile.TemporaryDirectory() as tmp:
        db = Database(Path(tmp) / "test.duckdb")
        generate_demo_dataset(db, n_days=3, seed=123)
        yield db
        db.close()
