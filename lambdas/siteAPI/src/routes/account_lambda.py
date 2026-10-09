import json
import re
import secrets
import time

from db import get_connection, json_to_DDB_dict, DDB_dict_to_json
from http_utils import parse_json_body, require_fields, BadRequest, Unauthorized, COOKIE_NAME
from routes.account_util import hash_password, verify_password, create_session_cookie
from util import create_id

USERS_TABLE_NAME = "mooseboardgames-user-dev"
# Maps username -> user_id. Keyed by username so DynamoDB can
# enforce that no two users share a name (the user table is keyed by user_id).
USERNAMES_TABLE_NAME = "mooseboardgames-username-dev"

# Letters, digits, underscore and space; 2-20 chars; no leading/trailing space.
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_ ]{0,18}[A-Za-z0-9_]$")
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 64


def _ok(body: dict, headers: dict | None = None) -> dict:
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", **(headers or {})},
        "body": json.dumps(body),
    }


def create_user(event: dict, path_params: dict) -> dict:
    dynamodb = get_connection()
    bodyJSON = parse_json_body(event)
    require_fields(bodyJSON, "username", "password", "email")
    username = bodyJSON["username"]
    password = bodyJSON["password"]
    email = bodyJSON["email"]

    if not isinstance(username, str) or not _USERNAME_RE.fullmatch(username):
        raise BadRequest("Username must be 2-20 letters, digits, '_' or spaces, "
                         "and cannot start or end with a space.")
    if not isinstance(password, str) or not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise BadRequest(f"Password must be {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters.")
    if not isinstance(email, str) or email == "":
        raise BadRequest("Email must be a non-empty string.")

    salt = secrets.token_bytes(16)
    user = {
        "user_id": create_id("u"),
        "email": email,
        "username": username,
        "password_hash": hash_password(password, salt),
        "password_salt": salt.hex(),
        "create_time": int(time.time()),
        "filter_settings": "default",
    }

    # Claim the username and create the user in one transaction, so if the
    # name is already taken neither row is written.
    try:
        dynamodb.transact_write_items(
            TransactItems=[
                {"Put": {
                    "TableName": USERNAMES_TABLE_NAME,
                    "Item": json_to_DDB_dict({"username": username, "user_id": user["user_id"]}),
                    "ConditionExpression": "attribute_not_exists(username)",
                }},
                {"Put": {
                    "TableName": USERS_TABLE_NAME,
                    "Item": json_to_DDB_dict(user),
                    "ConditionExpression": "attribute_not_exists(user_id)",
                }},
            ]
        )
    except dynamodb.exceptions.TransactionCanceledException as exc:
        reasons = exc.response.get("CancellationReasons", [])
        if reasons and reasons[0].get("Code") == "ConditionalCheckFailed":
            raise BadRequest("Username is already taken.")
        raise

    return _logged_in_response(user["user_id"])


def login(event: dict, path_params: dict) -> dict:
    dynamodb = get_connection()
    bodyJSON = parse_json_body(event)
    require_fields(bodyJSON, "username", "password")
    username = bodyJSON["username"]
    password = bodyJSON["password"]
    if not isinstance(username, str) or not isinstance(password, str):
        raise BadRequest("Username and password must be strings.")

    # Same error for unknown username and wrong password, so the response
    # doesn't reveal which usernames exist.
    bad_login = Unauthorized("Invalid username or password.")

    response = dynamodb.get_item(
        TableName=USERNAMES_TABLE_NAME,
        Key={"username": {"S": username}},
    )
    name_item = response.get("Item")
    if name_item is None:
        raise bad_login
    user_id = DDB_dict_to_json(name_item)["user_id"]

    response = dynamodb.get_item(
        TableName=USERS_TABLE_NAME,
        Key={"user_id": {"S": user_id}},
        ProjectionExpression="password_hash, password_salt",
    )
    user_item = response.get("Item")
    if user_item is None:
        raise bad_login
    user = DDB_dict_to_json(user_item)

    if not verify_password(password, user["password_salt"], user["password_hash"]):
        raise bad_login

    cookie_id = create_session_cookie(user_id)
    return _ok(
        {"user_id": user_id},
        headers={"Set-Cookie": f"{COOKIE_NAME}={cookie_id}; HttpOnly; Secure; SameSite=Strict; Path=/"},
    )    


def logout(event: dict, path_params: dict) -> dict:
    # TODO: invalidate cookie
    return _ok({"message": "logged out"})
