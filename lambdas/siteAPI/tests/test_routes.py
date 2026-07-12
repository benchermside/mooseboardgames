import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from handler import lambda_handler


def test_get_open_games_returns_200():
    event = {"httpMethod": "GET", "path": "/open-games", "body": None, "headers": {}}
    result = lambda_handler(event, None)
    assert result["statusCode"] == 200


def test_unknown_route_returns_404():
    event = {"httpMethod": "GET", "path": "/does-not-exist", "body": None, "headers": {}}
    result = lambda_handler(event, None)
    assert result["statusCode"] == 404


def test_path_param_routing():
    event = {"httpMethod": "DELETE", "path": "/open-games/abc123", "body": None, "headers": {}}
    result = lambda_handler(event, None)
    assert result["statusCode"] == 200
