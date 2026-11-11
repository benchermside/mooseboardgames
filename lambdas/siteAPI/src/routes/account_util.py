import hashlib
import hmac
import time

from db import get_connection, json_to_DDB_dict
from http_utils import COOKIE_NAME, SESSION_TABLE_NAME
from util import create_id

# How long a login lasts before the user has to log in again.
SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60


def hash_password(password: str, salt: bytes) -> str:
    """Return the scrypt hash of password with salt, as a hex string."""
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()


def verify_password(password: str, salt_hex: str, expected_hash: str) -> bool:
    """Return True if password hashes (with the stored salt) to expected_hash."""
    actual_hash = hash_password(password, bytes.fromhex(salt_hex))
    # compare_digest takes the same time wherever the strings differ, so an
    # attacker can't learn the hash one character at a time by timing us.
    return hmac.compare_digest(actual_hash, expected_hash)


def create_session(user_id: str) -> str:
    """Write a new session row for user_id and return its session_id."""
    session_id = create_id("s")
    session = {
        "session_id": session_id,
        "user_id": user_id,
        "expire_time": int(time.time()) + SESSION_DURATION_SECONDS,
    }
    get_connection().put_item(
        TableName=SESSION_TABLE_NAME,
        Item=json_to_DDB_dict(session),
        ConditionExpression="attribute_not_exists(session_id)",
    )
    return session_id


def create_session_cookie(session_id: str) -> str:
    """Return the Set-Cookie header value that hands session_id to the browser."""
    return (f"{COOKIE_NAME}={session_id}; Max-Age={SESSION_DURATION_SECONDS}; "
            f"HttpOnly; Secure; SameSite=Strict; Path=/")
