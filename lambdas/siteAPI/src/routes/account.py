import json


def _ok(body: dict) -> dict:
    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def login(event: dict, path_params: dict) -> dict:
    # TODO: validate credentials, return cookie
    return _ok({"message": "logged in"})


def signup(event: dict, path_params: dict) -> dict:
    # TODO: create user record, return cookie
    return _ok({"message": "signed up"})


def logout(event: dict, path_params: dict) -> dict:
    # TODO: invalidate cookie
    return _ok({"message": "logged out"})
