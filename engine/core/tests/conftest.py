"""Shared test setup for the core engine tests.

pytest finds fixtures in a `conftest.py` automatically, so every test file in this
folder can ask for `client` without importing anything. Keeping the one copy here
means the three core test files cannot drift apart.
"""

from fastapi.testclient import TestClient
import pytest

from engine.core import db
from engine.core.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A throwaway API client with its own empty data folder and no real API keys."""
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for key in db.SECRET_SETTINGS:
        monkeypatch.delenv(key.upper(), raising=False)
    with TestClient(app, base_url="http://localhost") as session:
        yield session
