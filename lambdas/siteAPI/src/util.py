import secrets
import base64
def create_id(prefix):
    """Creates a new ID starting with the prefix passed in. 
    Prefixes should be of the form "XXX", so for user_id, prefix is "u", the ID would be u_123...
    """
    binary_data = secrets.token_bytes(12)
    id = base64.urlsafe_b64encode(binary_data).decode("ascii")
    id = prefix + "_" + id
    return id
