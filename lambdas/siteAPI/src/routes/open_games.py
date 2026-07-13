import json

from db import get_connection

OPEN_GAMES_TABLE_NAME = "mooseboardgames-open_games-dev"

def _ok(body: dict) -> dict:
    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body)}


def get_open_games(event: dict, path_params: dict) -> dict:
    dynamodb = get_connection()
    # FIXME will need pagination (limitin the number of records that are read)
    response = dynamodb.scan(
        TableName=OPEN_GAMES_TABLE_NAME,
    )
    # FIXME need to deal with scan exceptions 
    for item in response["Items"]:
        print(item)
        #FIXME impliment
    return _ok([])


def create_open_game(event: dict, path_params: dict) -> dict:
    # TODO: parse body, insert into DB
    return _ok({"message": "created"})


def delete_open_game(event: dict, path_params: dict) -> dict:
    # TODO: delete open_game_id from DB
    return _ok({"message": "deleted"})


def join_open_game(event: dict, path_params: dict) -> dict:
    # TODO: add user to open_game_id in DB
    return _ok({"message": "joined"})
