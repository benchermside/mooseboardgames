import json

from db import get_connection, extract_from_type_dict, extract_from_type_list, DDB_dict_to_json, json_to_DDB_dict
from http_utils import parse_json_body
from util import create_id

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
    dynamodb = get_connection()
    user_id = "u_123456789" #FIXME
    bodyJSON = parse_json_body(event)
    """Need this for a new open_game
        open_game_id  (type string) (PK)
        game_name  (type enum)
        settings  (type settings)
        joined_users (type list user_id)
        owner_user_id (type string)
    """
    open_game = {
        "open_game_id" : create_id("og"),
        "game_name" : bodyJSON["game_name"],
        "settings" : bodyJSON["settings"],
        "joined_users" : [user_id],
        "owner_user_id" : user_id,
    }

    #add to database
    response = dynamodb.put_item(
        TableName=OPEN_GAMES_TABLE_NAME,
        Item=json_to_DDB_dict(open_game),
    )
    return _ok({"open_game_id": open_game["open_game_id"]})


def delete_open_game(event: dict, path_params: dict) -> dict:

    # TODO: delete open_game_id from DB
    return _ok({"message": "deleted"})


def join_open_game(event: dict, path_params: dict) -> dict:
    # TODO: add user to open_game_id in DB
    return _ok({"message": "joined"})
