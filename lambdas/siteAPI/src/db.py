# Database connection and query helpers.
import os

import boto3
from decimal import Decimal

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

def DDB_dict_to_json(DDB_format):
    """This takes a dictinary in the internial format that dynamoDB uses.
    It returns a python object that corrosponds to the data.
    example
    Input: {'game_type': {'S': 'CONNECT_4'}, 'joined_users': {'L': [{'S': 'uuuuuu1'}]}, 'owner_user_id': {'S': 'uuuuuu1'}, 'settings': {'S': '{}'}, 'open_game_id': {'S': 'oooooo1'}}
    Output: {'game_type': 'CONNECT_4', 'joined_users': ['uuuuuu1'], 'owner_user_id': 'uuuuuu1', 'settings':'{}', 'open_game_id':  'oooooo1'}
    """
    return {key:extract_from_type_dict(DDB_format[key]) for key in DDB_format}

def extract_from_type_dict(type_dict):
    """Takes a boto3 typedict and returns the value as the correct type
    example {'S': "candy"} returns "candy"
    """
    [(k, v)] = type_dict.items()
    if k == 'S':
        return v
    elif k == 'N':
        if '.' in v:
           return Decimal(v)
        else:
            return int(v)
    elif k == 'B':
        raise ValueError("byte data not supported")
    elif k == 'SS':
        return v
    elif k == 'NS':
        raise ValueError("number set not supported")
    elif k == 'BS':
        raise ValueError("byte set not supported")
    elif k == 'M':
        return {key:extract_from_type_dict(v[key]) for key in v}
    elif k == 'L':
        return extract_from_type_list(v)
    elif k == 'NULL':
        return None
    elif k == 'BOOL':
        return v
    else:
        raise ValueError("type_dict not in correct format")

def extract_from_type_list(type_list):
    """Takes a boto3 typelist and returns the value as the correct type
    example [{'S': "candy"}, {'N': "123"}] returns ["candy", 123]
    """
    print("extract_from_type_list input", type_list)
    return [extract_from_type_dict(x) for x in type_list]

def json_to_DDB_dict(json):
    """Creates a DDB_dict from a python json dict.
    Currently does not support "L" type.
    """
    return {key:transform_to_type_dict(json[key]) for key in json}


def transform_to_type_dict(data): 
    """Transforms the data to a type dict, for example "hi" -> {"S":"hi"}
    Currently does not support types "L" and "M",
    could be added in future with new optional parameter.
    """
    data_type = type(data)
    if data_type == str:
        return {"S":data}
    elif data_type == int or data_type == Decimal:
        return {"N":str(data)}
    elif data_type == list and all(type(elem) == str for elem in data):
        return {"SS":data}
    elif data_type == type(None):
        return {"NULL":None}
    elif data_type == bool:
        return {"BOOL":data}
    else:
        raise ValueError(f"Data type {data_type} not supported. the data value is {data}.")
