import json

import pytest

import game_launcher
from game_launcher import MATCHES_TABLE_NAME
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


class FakeECS:
    """Stands in for the boto3 ECS client, recording run_task calls."""

    def __init__(self, response=None, error=None):
        self.calls = []
        self.response = response or {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}
        self.error = error

    def run_task(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


@pytest.fixture
def launching(monkeypatch):
    """Turn on game launching, with a fake ECS. Returns a function to swap the fake."""
    monkeypatch.setenv("GAME_CLUSTER", "games")
    monkeypatch.setenv("GAME_TASK_DEFINITION", "game-server")
    monkeypatch.setenv("GAME_CONTAINER_NAME", "game-server")
    monkeypatch.setenv("GAME_SUBNETS", "subnet-a,subnet-b")
    monkeypatch.setenv("GAME_SECURITY_GROUP", "sg-1")

    def use(ecs):
        monkeypatch.setattr(game_launcher, "_ecs", ecs)
        return ecs

    use(FakeECS())
    return use


def _create_ur_game(player_count=2):
    body = {"game_name": "ur", "settings": json.dumps({"playerCount": player_count})}
    return lambda_handler(_event("POST", "/open-games", body), None)


def _match(dynamodb, match_id):
    item = dynamodb.get_item(TableName=MATCHES_TABLE_NAME, Key={"match_id": {"S": match_id}}).get("Item")
    return item


def test_create_open_game_writes_the_match_and_launches_its_server(dynamodb, launching):
    ecs = launching(FakeECS())
    result = _create_ur_game(player_count=3)
    assert result["statusCode"] == 200
    match_id = json.loads(result["body"])["open_game_id"]

    match = _match(dynamodb, match_id)
    assert match["status"] == {"S": "LAUNCHING"}
    assert match["task_arn"] == {"S": "arn:task/1"}
    assert match["game_name"] == {"S": "ur"}
    assert match["num_players"] == {"N": "3"}
    credentials = match["credentials"]["M"]
    assert sorted(credentials) == ["0", "1", "2"]
    assert len({c["S"] for c in credentials.values()}) == 3, "each seat has its own credential"

    [run] = ecs.calls
    assert run["cluster"] == "games"
    assert run["taskDefinition"] == "game-server"
    assert run["launchType"] == "FARGATE"
    assert run["clientToken"] == match_id
    assert run["networkConfiguration"]["awsvpcConfiguration"] == {
        "subnets": ["subnet-a", "subnet-b"],
        "securityGroups": ["sg-1"],
        "assignPublicIp": "ENABLED",
    }
    assert run["overrides"]["containerOverrides"] == [{
        "name": "game-server",
        "environment": [{"name": "MATCH_ID", "value": match_id}],
    }]
    assert run["tags"] == [{"key": "match_id", "value": match_id}]


def test_without_launch_settings_the_match_is_created_but_not_launched(dynamodb):
    result = _create_ur_game()
    assert result["statusCode"] == 200
    match_id = json.loads(result["body"])["open_game_id"]
    assert _match(dynamodb, match_id)["status"] == {"S": "CREATED"}


@pytest.mark.parametrize("ecs", [
    FakeECS(error=RuntimeError("AccessDeniedException: not allowed")),
    FakeECS(response={"tasks": [], "failures": [{"reason": "RESOURCE:CPU"}]}),
])
def test_when_the_server_cannot_start_the_match_is_aborted_and_no_open_game_is_made(dynamodb, launching, ecs):
    launching(ecs)
    result = _create_ur_game()
    assert result["statusCode"] == 503

    games = dynamodb.scan(TableName=OPEN_GAMES_TABLE_NAME)["Items"]
    assert games == []
    [match] = dynamodb.scan(TableName=MATCHES_TABLE_NAME)["Items"]
    assert match["status"] == {"S": "ABORTED"}
    assert "not allowed" in match["launch_error"]["S"] or "RESOURCE:CPU" in match["launch_error"]["S"]


@pytest.mark.parametrize("settings", ["not json", json.dumps({}), json.dumps({"playerCount": 0})])
def test_create_open_game_needs_a_player_count(dynamodb, settings):
    body = {"game_name": "ur", "settings": settings}
    result = lambda_handler(_event("POST", "/open-games", body), None)
    assert result["statusCode"] == 400


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
