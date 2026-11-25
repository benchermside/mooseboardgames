import json

import pytest

import game_launcher
from game_launcher import MATCHES_TABLE_NAME
from http_utils import COOKIE_NAME, SESSION_TABLE_NAME
from lambda_function import lambda_handler
from routes.open_games import OPEN_GAMES_TABLE_NAME

OWNER = "u_123456789"
# Users with a logged-in session in every test (see the sessions fixture).
USERS = [OWNER, "u_2", "u_3"]


@pytest.fixture(autouse=True)
def sessions(dynamodb):
    """Log in each of USERS: session s_<user_id>, which never expires."""
    for user_id in USERS:
        dynamodb.put_item(
            TableName=SESSION_TABLE_NAME,
            Item={"session_id": {"S": f"s_{user_id}"}, "user_id": {"S": user_id}},
        )


def _event(method: str, path: str, body: dict | None = None, user: str | None = OWNER) -> dict:
    """Build a Lambda Function URL (payload format 2.0) event, sent by user
    (logged in), or by nobody if user is None."""
    return {
        "version": "2.0",
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": json.dumps(body) if body is not None else None,
        "headers": {},
        "cookies": [f"{COOKIE_NAME}=s_{user}"] if user is not None else [],
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

    def __init__(self, response=None, error=None, on_run=None):
        self.calls = []
        self.response = response or {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}
        self.error = error
        # Called with run_task's arguments, to act out what happens meanwhile.
        self.on_run = on_run

    def run_task(self, **kwargs):
        self.calls.append(kwargs)
        if self.on_run:
            self.on_run(kwargs)
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


def test_a_server_that_is_ready_first_stays_ready(dynamodb, launching):
    def server_marks_ready(run):
        dynamodb.update_item(
            TableName=MATCHES_TABLE_NAME,
            Key={"match_id": {"S": run["clientToken"]}},
            UpdateExpression="SET #status = :ready",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":ready": {"S": "READY"}},
        )

    launching(FakeECS(on_run=server_marks_ready))
    result = _create_ur_game()
    assert result["statusCode"] == 200
    match = _match(dynamodb, json.loads(result["body"])["open_game_id"])
    assert match["status"] == {"S": "READY"}
    assert match["task_arn"] == {"S": "arn:task/1"}


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
    result = lambda_handler(_event("PUT", "/open-games/abc123", user="u_2"), None)
    assert json.loads(result["body"])["message"] == "joined"

    result = lambda_handler(_event("PUT", "/open-games/leave/abc123", user="u_2"), None)
    assert json.loads(result["body"])["message"] == "left"


def test_join_full_game(dynamodb):
    _put_game(dynamodb, "abc123", "u_123456789", ["u_123456789"], player_count=1)
    result = lambda_handler(_event("PUT", "/open-games/abc123", user="u_2"), None)
    assert json.loads(result["body"])["message"] == "gameFull"


@pytest.mark.parametrize("method, path", [
    ("POST", "/open-games"),
    ("DELETE", "/open-games/abc123"),
    ("PUT", "/open-games/abc123"),
    ("PUT", "/open-games/leave/abc123"),
    ("GET", "/open-games/abc123/match"),
])
def test_open_game_changes_need_a_login(dynamodb, method, path):
    _put_game(dynamodb, "abc123", OWNER, [OWNER])
    body = {"game_name": "ur", "settings": json.dumps({"playerCount": 2})} if method == "POST" else None
    result = lambda_handler(_event(method, path, body, user=None), None)
    assert result["statusCode"] == 401


def test_the_creator_is_the_owner_and_first_player(dynamodb):
    result = _create_ur_game()
    game_id = json.loads(result["body"])["open_game_id"]
    item = dynamodb.get_item(TableName=OPEN_GAMES_TABLE_NAME, Key={"open_game_id": {"S": game_id}})["Item"]
    assert item["owner_user_id"] == {"S": OWNER}
    assert item["joined_users"] == {"SS": [OWNER]}


# --- Getting the connection to the match (T12) ---

def _put_match(dynamodb, match_id: str, status: str, num_players: int = 2) -> None:
    dynamodb.put_item(
        TableName=MATCHES_TABLE_NAME,
        Item={
            "match_id": {"S": match_id},
            "status": {"S": status},
            "credentials": {"M": {str(seat): {"S": f"cred{seat}"} for seat in range(num_players)}},
        },
    )


def _connection(game_id: str, user: str) -> dict:
    result = lambda_handler(_event("GET", f"/open-games/{game_id}/match", user=user), None)
    assert result["statusCode"] == 200, result["body"]
    return json.loads(result["body"])


def test_no_connection_until_every_seat_is_taken(dynamodb):
    _put_game(dynamodb, "og_1", OWNER, [OWNER], player_count=2)
    _put_match(dynamodb, "og_1", "READY")
    assert _connection("og_1", OWNER) == {"status": "WAITING_FOR_PLAYERS"}


@pytest.mark.parametrize("status", ["CREATED", "LAUNCHING", "CANCELLED", "ABORTED"])
def test_no_connection_unless_the_server_is_up(dynamodb, status):
    _put_game(dynamodb, "og_1", OWNER, [OWNER, "u_2"])
    _put_match(dynamodb, "og_1", status)
    assert _connection("og_1", OWNER) == {"status": status}


@pytest.mark.parametrize("status", ["READY", "IN_PROGRESS"])
def test_each_player_gets_their_own_seat_once_ready(dynamodb, status):
    _put_game(dynamodb, "og_1", "u_3", ["u_3", "u_2", OWNER], player_count=3)
    _put_match(dynamodb, "og_1", status, num_players=3)
    # Seats go in sorted order of user ID.
    for seat, user in enumerate(sorted(["u_3", "u_2", OWNER])):
        assert _connection("og_1", user) == {
            "status": status,
            "match_id": "og_1",
            "path": "/m/og_1",
            "player_id": str(seat),
            "credentials": f"cred{seat}",
        }


def test_only_players_in_the_game_get_a_connection(dynamodb):
    _put_game(dynamodb, "og_1", OWNER, [OWNER, "u_2"])
    _put_match(dynamodb, "og_1", "READY")
    result = lambda_handler(_event("GET", "/open-games/og_1/match", user="u_3"), None)
    assert result["statusCode"] == 400
