import json
import time

import pytest

from db import DDB_dict_to_json
from http_utils import SESSION_TABLE_NAME, Unauthorized, authenticate_request
from lambda_function import lambda_handler
from routes.account_lambda import USERS_TABLE_NAME, USERNAMES_TABLE_NAME
from routes.account_util import hash_password, SESSION_DURATION_SECONDS


def _signup(username="moose_fan", password="hunter2hunter2", email="a@b.com") -> dict:
    body = {"username": username, "password": password, "email": email}
    event = {
        "version": "2.0",
        "rawPath": "/account-signup",
        "requestContext": {"http": {"method": "POST", "path": "/account-signup"}},
        "body": json.dumps(body),
        "headers": {},
    }
    return lambda_handler(event, None)


def test_create_user_writes_user_and_username(dynamodb):
    result = _signup()
    assert result["statusCode"] == 200
    user_id = json.loads(result["body"])["user_id"]
    assert result["headers"]["Set-Cookie"].startswith("cookie_id=")

    item = dynamodb.get_item(TableName=USERS_TABLE_NAME, Key={"user_id": {"S": user_id}})["Item"]
    user = DDB_dict_to_json(item)
    assert user["username"] == "moose_fan"
    assert user["email"] == "a@b.com"
    assert user["filter_settings"] == "default"
    assert isinstance(user["create_time"], int)
    assert user["password_hash"] == hash_password("hunter2hunter2", bytes.fromhex(user["password_salt"]))
    assert "hunter2hunter2" not in json.dumps(user)

    name_item = dynamodb.get_item(TableName=USERNAMES_TABLE_NAME, Key={"username": {"S": "moose_fan"}})["Item"]
    assert name_item["user_id"]["S"] == user_id


def test_same_email_allowed_twice():
    assert _signup(username="one")["statusCode"] == 200
    assert _signup(username="two")["statusCode"] == 200


@pytest.mark.parametrize("username", ["", " leading", "trailing ", "bad-char", "x" * 21])
def test_invalid_username_rejected(username):
    assert _signup(username=username)["statusCode"] == 400


@pytest.mark.parametrize("password", ["short", "x" * 65])
def test_invalid_password_rejected(password):
    assert _signup(password=password)["statusCode"] == 400


def test_missing_field_rejected():
    event = {
        "requestContext": {"http": {"method": "POST", "path": "/account-signup"}},
        "body": json.dumps({"username": "moose_fan"}),
    }
    assert lambda_handler(event, None)["statusCode"] == 400


def _login(username="moose_fan", password="hunter2hunter2") -> dict:
    event = {
        "version": "2.0",
        "rawPath": "/account-login",
        "requestContext": {"http": {"method": "POST", "path": "/account-login"}},
        "body": json.dumps({"username": username, "password": password}),
        "headers": {},
    }
    return lambda_handler(event, None)


def test_login_with_correct_password():
    user_id = json.loads(_signup()["body"])["user_id"]
    result = _login()
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["user_id"] == user_id
    assert result["headers"]["Set-Cookie"].startswith("cookie_id=")


def test_login_with_wrong_password_returns_401():
    _signup()
    assert _login(password="wrong_password")["statusCode"] == 401


def test_login_unknown_username_returns_401():
    assert _login(username="nobody")["statusCode"] == 401


def test_login_username_is_case_sensitive():
    _signup(username="moose_fan")
    assert _login(username="Moose_Fan")["statusCode"] == 401


def test_login_missing_field_returns_400():
    event = {
        "requestContext": {"http": {"method": "POST", "path": "/account-login"}},
        "body": json.dumps({"username": "moose_fan"}),
    }
    assert lambda_handler(event, None)["statusCode"] == 400


def _session_id(result: dict) -> str:
    """Pull the session_id out of a response's Set-Cookie header."""
    first_part = result["headers"]["Set-Cookie"].split(";")[0]
    name, _, value = first_part.partition("=")
    assert name == "cookie_id"
    return value


def _get_session(dynamodb, session_id: str) -> dict:
    item = dynamodb.get_item(TableName=SESSION_TABLE_NAME, Key={"session_id": {"S": session_id}})["Item"]
    return DDB_dict_to_json(item)


@pytest.mark.parametrize("do_login", [False, True])
def test_signup_and_login_write_session(dynamodb, do_login):
    result = _signup()
    user_id = json.loads(result["body"])["user_id"]
    if do_login:
        result = _login()
    assert f"Max-Age={SESSION_DURATION_SECONDS}" in result["headers"]["Set-Cookie"]

    session = _get_session(dynamodb, _session_id(result))
    assert session["user_id"] == user_id
    assert abs(session["expire_time"] - (time.time() + SESSION_DURATION_SECONDS)) < 60


def test_each_login_gets_a_new_session():
    _signup()
    assert _session_id(_login()) != _session_id(_login())


def test_session_cookie_authenticates():
    result = _signup()
    user_id = json.loads(result["body"])["user_id"]
    event = {"cookies": [f"cookie_id={_session_id(result)}"]}
    assert authenticate_request(event) == user_id


def test_expired_session_rejected(dynamodb):
    session_id = _session_id(_signup())
    dynamodb.update_item(
        TableName=SESSION_TABLE_NAME,
        Key={"session_id": {"S": session_id}},
        UpdateExpression="SET expire_time = :t",
        ExpressionAttributeValues={":t": {"N": str(int(time.time()) - 1)}},
    )
    with pytest.raises(Unauthorized):
        authenticate_request({"cookies": [f"cookie_id={session_id}"]})


def test_unknown_session_rejected():
    with pytest.raises(Unauthorized):
        authenticate_request({"cookies": ["cookie_id=s_nonexistent"]})
