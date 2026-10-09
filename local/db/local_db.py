"""Create (and seed) the DynamoDB Local tables.

Usage: python local_db.py [--reset]

Creates any of the site's tables that don't exist yet. A table that gets
created is filled with sample data, so the site is usable before signup and
login exist. Tables that already exist are left alone, so local data survives
restarts. --reset drops every table first, putting everything back to the
sample data.

Reads DYNAMODB_ENDPOINT_URL (and the usual AWS_* variables) from the
environment; local/compose.yaml sets them.
"""
import os
import sys
import time

import boto3
from botocore.exceptions import EndpointConnectionError

# table name -> its partition key (all keys are strings)
TABLES = {
    "mooseboardgames-open_games-dev": "open_game_id",
    "mooseboardgames-cookie-dev": "cookie_id",
    "mooseboardgames-user-dev": "user_id",
    "mooseboardgames-session-dev": "session_id",
}

# The routes currently hard-code this user until authentication is wired up.
SAMPLE_USER_ID = "u_123456789"

SAMPLE_DATA = {
    "mooseboardgames-user-dev": [
        {
            "user_id": {"S": SAMPLE_USER_ID},
            "username": {"S": "localdev"},
            "email": {"S": "localdev@example.com"},
            "create_time": {"N": "0"},
        },
    ],
    "mooseboardgames-cookie-dev": [
        # No expire_time, so it never expires. Use it in a browser with
        # document.cookie = "cookie_id=c_localdev"
        {
            "cookie_id": {"S": "c_localdev"},
            "user_id": {"S": SAMPLE_USER_ID},
        },
    ],
    "mooseboardgames-open_games-dev": [
        {
            "open_game_id": {"S": "og_sample"},
            "game_name": {"S": "CONNECT_4"},
            "settings": {"S": '{"playerCount": 2}'},
            "joined_users": {"SS": [SAMPLE_USER_ID]},
            "owner_user_id": {"S": SAMPLE_USER_ID},
        },
    ],
}


def connect(timeout_seconds: int = 60):
    """Return a DynamoDB client, waiting for DynamoDB Local to start accepting connections."""
    client = boto3.client(
        "dynamodb",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        endpoint_url=os.environ.get("DYNAMODB_ENDPOINT_URL", "http://localhost:8000"),
    )
    deadline = time.time() + timeout_seconds
    while True:
        try:
            client.list_tables()
            return client
        except EndpointConnectionError:
            if time.time() > deadline:
                raise
            print("Waiting for DynamoDB Local...")
            time.sleep(1)


def drop_tables(client) -> None:
    existing = set(client.list_tables()["TableNames"])
    for name in TABLES:
        if name in existing:
            client.delete_table(TableName=name)
            client.get_waiter("table_not_exists").wait(TableName=name)
            print(f"Dropped {name}")


def create_tables(client) -> None:
    existing = set(client.list_tables()["TableNames"])
    for name, key in TABLES.items():
        if name in existing:
            print(f"{name} already exists")
            continue
        client.create_table(
            TableName=name,
            KeySchema=[{"AttributeName": key, "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": key, "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        client.get_waiter("table_exists").wait(TableName=name)
        for item in SAMPLE_DATA.get(name, []):
            client.put_item(TableName=name, Item=item)
        print(f"Created {name} with {len(SAMPLE_DATA.get(name, []))} sample item(s)")


def main() -> None:
    client = connect()
    if "--reset" in sys.argv[1:]:
        drop_tables(client)
    create_tables(client)


if __name__ == "__main__":
    main()
