import json


def _ok(body: dict) -> dict:
    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def start_session(event: dict, path_params: dict) -> dict:
    # TODO: create session record, return session_id
    return _ok({"message": "session started"})
