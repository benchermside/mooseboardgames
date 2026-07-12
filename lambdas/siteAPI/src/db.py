# Database connection and query helpers.
import os

import boto3

_connection = None


def get_connection():
    """Return a boto3 DynamoDB resource, creating it on first use.

    Honors AWS_REGION and DYNAMODB_ENDPOINT_URL env vars so the same code
    can point at real DynamoDB or a local instance (e.g. dynamodb-local).
    """
    global _connection
    if _connection is None:
        _connection = boto3.client("dynamodb")

        # _connection = boto3.resource(
        #     "dynamodb",
        #     region_name=os.environ.get("AWS_REGION", "us-east-1"),
        #     endpoint_url=os.environ.get("DYNAMODB_ENDPOINT_URL"),
        # )
    return _connection

