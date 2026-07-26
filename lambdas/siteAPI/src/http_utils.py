# Helpers for reading input out of a Lambda proxy (payload format 2.0) event.
import base64
import json
import time

from db import get_connection, DDB_dict_to_json

COOKIE_TABLE_NAME = "mooseboardgames-cookie-dev"

# Name of the cookie the browser sends, e.g. "Cookie: cookie_id=abc123".
COOKIE_NAME = "cookie_id"


class BadRequest(Exception):
    """Raised when the client sent input we can't use (bad JSON, missing fields).

    lambda_handler catches this and turns it into a 400 response instead of a 500.
    """


class Unauthorized(Exception):
    """Raised when the request has no valid session cookie.

    lambda_handler catches this and turns it into a 401 response.
    """


def parse_json_body(event: dict) -> dict:
    """Return the request body parsed from JSON into a python JSON object.

    Handles the two quirks of event["body"]: it may be absent/None (e.g. GET
    requests, or a POST with no body), and it may be base64-encoded when
    event["isBase64Encoded"] is True. Raises BadRequest if the body isn't
    valid JSON or isn't a JSON object.
    """
    raw = event.get("body")
    if raw is None or raw == "":
        raise BadRequest("Request body was empty.")

    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw).decode()
        except Exception as exc:
            raise BadRequest("Request body is not valid base64.") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BadRequest("Request body is not valid JSON.") from exc

    return parsed


def require_fields(body: dict, *fields: str) -> None:
    """Raise BadRequest if any of the named keys are missing from body."""
    missing = [f for f in fields if f not in body]
    if missing:
        raise BadRequest(f"Missing required field(s): {', '.join(missing)}")


def _read_cookie_id(event: dict) -> str | None:
    """Pull our session cookie's value out of a Lambda proxy (v2.0) event.

    Payload format 2.0 delivers cookies as a list of "name=value" strings in
    event["cookies"]. We fall back to parsing a raw "Cookie" header in case the
    event is shaped differently.
    """
    cookie_strings = event.get("cookies")
    if not cookie_strings:
        # Fall back to the raw header (headers are lower-cased in v2.0).
        header = (event.get("headers") or {}).get("cookie", "")
        cookie_strings = [c.strip() for c in header.split(";")] if header else []

    for pair in cookie_strings:
        name, _, value = pair.partition("=")
        if name.strip() == COOKIE_NAME:
            return value.strip()
    return None


def authenticate_request(event: dict) -> str:
    """Validate the request's session cookie and return the owning user_id.

    Reads cookie_id from the Cookie header, looks it up in the cookie table,
    and confirms it exists and has not expired. Raises Unauthorized on any
    failure so lambda_handler can return a 401.
    """
    cookie_id = _read_cookie_id(event)
    if not cookie_id:
        raise Unauthorized("No session cookie provided.")

    dynamodb = get_connection()
    response = dynamodb.get_item(
        TableName=COOKIE_TABLE_NAME,
        Key={"cookie_id": {"S": cookie_id}},
    )

    item = response.get("Item")
    if item is None:
        raise Unauthorized("Invalid session cookie.")

    record = DDB_dict_to_json(item)

    expire_time = record.get("expire_time")
    if expire_time is not None and int(expire_time) <= int(time.time()):
        raise Unauthorized("Session cookie has expired.")

    return record["user_id"]
