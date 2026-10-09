import hashlib
import hmac

from util import create_id


def hash_password(password: str, salt: bytes) -> str:
    """Return the scrypt hash of password with salt, as a hex string."""
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()


def verify_password(password: str, salt_hex: str, expected_hash: str) -> bool:
    """Return True if password hashes (with the stored salt) to expected_hash."""
    actual_hash = hash_password(password, bytes.fromhex(salt_hex))
    # compare_digest takes the same time wherever the strings differ, so an
    # attacker can't learn the hash one character at a time by timing us.
    return hmac.compare_digest(actual_hash, expected_hash)


def create_session_cookie(user_id: str) -> str:
    """Create a login cookie for user_id and return its cookie_id."""
    # TODO: write a row to the cookie table (cookie_id, user_id, expire_time).
    #   Until then the returned id is not stored, so it won't authenticate.
    return create_id("c")
