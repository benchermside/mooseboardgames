import json

from db import get_connection, extract_from_type_dict, extract_from_type_list, DDB_dict_to_json, json_to_DDB_dict
from http_utils import parse_json_body, BadRequest, Unauthorized
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
    dynamodb = get_connection()
    user_id = "u_123456789" #FIXME should authenticate user
    target_game = path_params["open_game_id"]
    try:
        response = dynamodb.delete_item(
            TableName=OPEN_GAMES_TABLE_NAME,
            Key={"open_game_id": {"S": target_game}},
            ConditionExpression="owner_user_id = :uid",
            ExpressionAttributeValues={":uid": {"S": user_id}},
        )
    except dynamodb.exceptions.ConditionalCheckFailedException:
        raise Unauthorized("You are not the owner of that game.")
    return _ok({"message": f"deleted game {target_game}"})


def join_open_game(event: dict, path_params: dict) -> dict:
    dynamodb = get_connection()
    user_id = "u_2" #FIXME should authenticate user
    target_game = path_params["open_game_id"]
    response = dynamodb.get_item(
        TableName=OPEN_GAMES_TABLE_NAME,
        Key={"open_game_id": {"S": target_game}},
        ProjectionExpression="joined_users, settings",
    )
    item = response.get("Item")
    if item is None:
        raise BadRequest(f"There is no open game with id {target_game}.")
    open_game = DDB_dict_to_json(item)

    current_players = open_game["joined_users"]
    if user_id in current_players:
        return _ok({"message": "alreadyInGame"})

    player_count = json.loads(open_game["settings"])["playerCount"]
    if len(current_players) >= player_count:
        return _ok({"message": "gameFull"})

    # TODO: this read-then-write has a race: two players can both see room in
    #   the game and both join, overfilling it. Fix later, probably with a
    #   ConditionExpression on size(joined_users) in the update below.
    dynamodb.update_item(
        TableName=OPEN_GAMES_TABLE_NAME,
        Key={"open_game_id": {"S": target_game}},
        UpdateExpression="ADD joined_users :uid",
        ExpressionAttributeValues={":uid": {"SS": [user_id]}},
    )
    return _ok({"message": "joined"})


def leave_open_game(event: dict, path_params: dict) -> dict:
    dynamodb = get_connection()
    user_id = "u_2" #FIXME should authenticate user
    target_game = path_params["open_game_id"]
    response = dynamodb.get_item(
        TableName=OPEN_GAMES_TABLE_NAME,
        Key={"open_game_id": {"S": target_game}},
        ProjectionExpression="owner_user_id",
    )
    item = response.get("Item")
    if item is None:
        raise BadRequest(f"There is no open game with id {target_game}.")
    if DDB_dict_to_json(item)["owner_user_id"] == user_id:
        raise BadRequest("The owner cannot leave their own game, only delete it.")

    try:
        dynamodb.update_item(
            TableName=OPEN_GAMES_TABLE_NAME,
            Key={"open_game_id": {"S": target_game}},
            UpdateExpression="DELETE joined_users :uid_set",
            ConditionExpression="contains(joined_users, :uid)",
            ExpressionAttributeValues={
                ":uid_set": {"SS": [user_id]},  # DELETE needs a set
                ":uid": {"S": user_id},         # contains() needs a scalar
            },
        )
    except dynamodb.exceptions.ConditionalCheckFailedException:
        return _ok({"message": "notInGame"})
    return _ok({"message": "left"})


