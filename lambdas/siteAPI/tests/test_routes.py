import json

from lambda_function import lambda_handler
from routes.open_games import OPEN_GAMES_TABLE_NAME


def _event(method: str, path: str, body: dict | None = None) -> dict:
    """Build a Lambda Function URL (payload format 2.0) event."""
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": json.dumps(body) if body is not None else None,
        "headers": {},
    }


def _put_game(dynamodb, game_id: str, owner: str, joined: list[str], player_count: int = 2) -> None:
    dynamodb.put_item(
        TableName=OPEN_GAMES_TABLE_NAME,
        Item={
            "open_game_id": {"S": game_id},
            "game_name": {"S": "CONNECT_4"},
            "settings": {"S": json.dumps({"playerCount": player_count})},
            "joined_users": {"SS": joined},
            "owner_user_id": {"S": owner},
        },
    )


def test_get_open_games_returns_200(dynamodb):
    _put_game(dynamodb, "abc123", "u_123456789", ["u_123456789"])
    result = lambda_handler(_event("GET", "/open-games"), None)
    assert result["statusCode"] == 200
    games = json.loads(result["body"])
    assert [g["open_game_id"] for g in games] == ["abc123"]


def test_unknown_route_returns_404():
    result = lambda_handler(_event("GET", "/does-not-exist"), None)
    assert result["statusCode"] == 404


def test_create_open_game(dynamodb):
    body = {"game_name": "CONNECT_4", "settings": json.dumps({"playerCount": 2})}
    result = lambda_handler(_event("POST", "/open-games", body), None)
    assert result["statusCode"] == 200
    game_id = json.loads(result["body"])["open_game_id"]
    item = dynamodb.get_item(TableName=OPEN_GAMES_TABLE_NAME, Key={"open_game_id": {"S": game_id}})
    assert "Item" in item


def test_path_param_routing(dynamodb):
    _put_game(dynamodb, "abc123", "u_123456789", ["u_123456789"])
    result = lambda_handler(_event("DELETE", "/open-games/abc123"), None)
    assert result["statusCode"] == 200


def test_delete_game_owned_by_someone_else_returns_401(dynamodb):
    _put_game(dynamodb, "abc123", "u_other", ["u_other"])
    result = lambda_handler(_event("DELETE", "/open-games/abc123"), None)
    assert result["statusCode"] == 401


def test_join_then_leave_open_game(dynamodb):
    _put_game(dynamodb, "abc123", "u_123456789", ["u_123456789"])
    result = lambda_handler(_event("PUT", "/open-games/abc123"), None)
    assert json.loads(result["body"])["message"] == "joined"

    result = lambda_handler(_event("PUT", "/open-games/leave/abc123"), None)
    assert json.loads(result["body"])["message"] == "left"


def test_join_full_game(dynamodb):
    _put_game(dynamodb, "abc123", "u_123456789", ["u_123456789"], player_count=1)
    result = lambda_handler(_event("PUT", "/open-games/abc123"), None)
    assert json.loads(result["body"])["message"] == "gameFull"
