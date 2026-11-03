"""Never create test keys in the user's system keyring or private-key folder."""

import pytest


@pytest.fixture(autouse=True)
def isolated_private_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("SHORTFORGE_KEY_STORAGE", "file")
    monkeypatch.setenv(
        "SHORTFORGE_PRIVATE_KEYS_DIR",
        str(tmp_path.parent / "private-test-keys" / tmp_path.name),
    )
