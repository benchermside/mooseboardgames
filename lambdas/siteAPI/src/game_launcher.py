"""Create a match and start its game server (design T10).

When a player creates an open game, the lobby writes a match record (see
documentation/match-record.md) and starts a Fargate task to host the match.
The match ID is the open game's ID.

The game server settings come from environment variables, which Terraform
sets on the siteAPI Lambda. When they aren't set (local development, most
tests), the match record is written but no server is started.
"""
import os
import secrets
from datetime import datetime, timezone

import boto3

from db import get_connection

MATCHES_TABLE_NAME = "mooseboardgames-matches-dev"

_ecs = None


def get_ecs():
    """Return a boto3 ECS client, creating it on first use."""
    global _ecs
    if _ecs is None:
        _ecs = boto3.client("ecs", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    return _ecs


def launch_config() -> dict | None:
    """The game server settings, or None if launching isn't configured."""
    if not os.environ.get("GAME_CLUSTER"):
        return None
    return {
        "cluster": os.environ["GAME_CLUSTER"],
        "task_definition": os.environ["GAME_TASK_DEFINITION"],
        "container_name": os.environ["GAME_CONTAINER_NAME"],
        "subnets": os.environ["GAME_SUBNETS"].split(","),
        "security_group": os.environ["GAME_SECURITY_GROUP"],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_match(match_id: str, game_name: str, num_players: int) -> bool:
    """Write the match record and start its game server.

    Returns False if the server couldn't be started. The match is then
    ABORTED, with the reason in launch_error.
    """
    dynamodb = get_connection()
    credentials = {str(seat): {"S": secrets.token_urlsafe(16)} for seat in range(num_players)}
    now = _now()
    dynamodb.put_item(
        TableName=MATCHES_TABLE_NAME,
        Item={
            "match_id": {"S": match_id},
            "status": {"S": "CREATED"},
            "game_name": {"S": game_name},
            "num_players": {"N": str(num_players)},
            "credentials": {"M": credentials},
            "created_at": {"S": now},
            "updated_at": {"S": now},
        },
    )

    config = launch_config()
    if config is None:
        print(f"Game launching isn't configured; match {match_id} stays CREATED")
        return True

    try:
        task_arn = _run_task(config, match_id)
    except Exception as exc:
        print(f"Couldn't start the game server for {match_id}: {exc}")
        _set_status(match_id, "ABORTED", {"launch_error": {"S": str(exc)}})
        return False

    try:
        _set_status(match_id, "LAUNCHING", {"task_arn": {"S": task_arn}})
    except get_connection().exceptions.ConditionalCheckFailedException:
        # The server already marked the match READY (it was very quick), or
        # the match is over. Leave the status alone; just keep the task ARN.
        get_connection().update_item(
            TableName=MATCHES_TABLE_NAME,
            Key={"match_id": {"S": match_id}},
            UpdateExpression="SET task_arn = :task_arn, updated_at = :now",
            ExpressionAttributeValues={":task_arn": {"S": task_arn}, ":now": {"S": _now()}},
        )
    return True


def _run_task(config: dict, match_id: str) -> str:
    """Start the game server task for the match and return its ARN."""
    response = get_ecs().run_task(
        cluster=config["cluster"],
        taskDefinition=config["task_definition"],
        launchType="FARGATE",
        count=1,
        # If this is ever retried for the same match, ECS starts only one task.
        clientToken=match_id,
        startedBy="lobby",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": config["subnets"],
                "securityGroups": [config["security_group"]],
                # Needed for CloudFront to reach the task (there's no NAT gateway).
                "assignPublicIp": "ENABLED",
            },
        },
        overrides={
            "containerOverrides": [{
                "name": config["container_name"],
                "environment": [{"name": "MATCH_ID", "value": match_id}],
            }],
        },
        tags=[{"key": "match_id", "value": match_id}],
    )
    tasks = response.get("tasks") or []
    if not tasks:
        reasons = "; ".join(f.get("reason", "") for f in response.get("failures") or [])
        raise RuntimeError(f"RunTask started no task: {reasons or 'no reason given'}")
    return tasks[0]["taskArn"]


def _set_status(match_id: str, status: str, extra: dict) -> None:
    """Move the match on from CREATED to status, and set other attributes (in
    DynamoDB format). Raises ConditionalCheckFailedException if the match is
    no longer CREATED, so this never undoes the game server's READY."""
    values = {":status": {"S": status}, ":now": {"S": _now()}, ":created": {"S": "CREATED"}}
    sets = ["#status = :status", "updated_at = :now"]
    for name, value in extra.items():
        values[f":{name}"] = value
        sets.append(f"{name} = :{name}")
    get_connection().update_item(
        TableName=MATCHES_TABLE_NAME,
        Key={"match_id": {"S": match_id}},
        UpdateExpression="SET " + ", ".join(sets),
        ConditionExpression="#status = :created",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )
