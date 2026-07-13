import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from lambda_function import lambda_handler


def _event(method: str, path: str) -> dict:
    """Build a Lambda Function URL (payload format 2.0) event."""
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": None,
        "headers": {},
    }


def test_get_open_games_returns_200():
    result = lambda_handler(_event("GET", "/open-games"), None)
    assert result["statusCode"] == 200


def test_unknown_route_returns_404():
    result = lambda_handler(_event("GET", "/does-not-exist"), None)
    assert result["statusCode"] == 404


def test_path_param_routing():
    result = lambda_handler(_event("DELETE", "/open-games/abc123"), None)
    assert result["statusCode"] == 200
