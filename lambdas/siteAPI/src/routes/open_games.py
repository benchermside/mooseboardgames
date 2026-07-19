import json

from db import get_connection, extract_from_type_dict, extract_from_type_list, DDB_dict_to_json


OPEN_GAMES_TABLE_NAME = "mooseboardgames-open_games-dev"

def _ok(body: dict|list) -> dict:
    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def get_open_games(event: dict, path_params: dict) -> dict:
    dynamodb = get_connection()
    # FIXME will need pagination (limitin the number of records that are read)
    response = dynamodb.scan(
        TableName=OPEN_GAMES_TABLE_NAME,
    )
    body = [DDB_dict_to_json(x) for x in response["Items"]]
    return _ok(body)


def create_open_game(event: dict, path_params: dict) -> dict:
    # TODO: parse body, insert into DB
    return _ok({"message": "created"})


def delete_open_game(event: dict, path_params: dict) -> dict:
    # TODO: delete open_game_id from DB
    return _ok({"message": "deleted"})


def join_open_game(event: dict, path_params: dict) -> dict:
    # TODO: add user to open_game_id in DB
    return _ok({"message": "joined"})
