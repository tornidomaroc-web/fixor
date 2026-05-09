# tests/conftest.py
# Test-only helpers. Not imported by the application package.
import jwt
import pytest


def make_test_token(user_id: str) -> str:
    """Build a token with a fixed signing secret for use in pytest fixtures."""
    return jwt.encode({"sub": user_id}, key="test-secret", algorithm="HS256")


def decode_for_assertion(token: str) -> dict:
    """Decode without verifying signature -- only used to assert claim shape in tests."""
    return jwt.decode(token, options={"verify_signature": False})


@pytest.fixture
def user_token() -> str:
    return make_test_token("u_abc")
