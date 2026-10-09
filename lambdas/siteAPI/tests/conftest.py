import os
import sys

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# Fake credentials so boto3 never picks up the real ones in ~/.aws.
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ.pop("AWS_PROFILE", None)

import db
from http_utils import COOKIE_TABLE_NAME
from routes.open_games import OPEN_GAMES_TABLE_NAME


def _create_table(client, name: str, key: str) -> None:
    client.create_table(
        TableName=name,
        KeySchema=[{"AttributeName": key, "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": key, "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


@pytest.fixture(autouse=True)
def dynamodb():
    """Run every test against an in-memory fake DynamoDB with empty tables."""
    with mock_aws():
        # db caches its client globally; reset so it's created inside the mock.
        db._connection = None
        client = boto3.client("dynamodb")
        _create_table(client, OPEN_GAMES_TABLE_NAME, "open_game_id")
        _create_table(client, COOKIE_TABLE_NAME, "cookie_id")
        yield client
        db._connection = None
