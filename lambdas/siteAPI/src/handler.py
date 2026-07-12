import json
from typing import Callable

from routes import open_games, account, session


def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


_ROUTES: dict[tuple[str, str], Callable] = {
    ("GET",    "/open-games"):                open_games.get_open_games,
    ("POST",   "/open-games"):                open_games.create_open_game,
    ("DELETE", "/open-games/{open_game_id}"): open_games.delete_open_game,
    ("PUT",    "/open-games/{open_game_id}"): open_games.join_open_game,
    ("POST",   "/account-login"):             account.login,
    ("POST",   "/account-signup"):            account.signup,
    ("POST",   "/account-logout"):            account.logout,
    ("POST",   "/start-session"):             session.start_session,
}


def _match_route(method: str, path: str) -> tuple[Callable | None, dict]:
    """Match method+path against the route table, returning (handler_fn, path_params). 
    Only works if perams in _ROUTES are surrounded with '/'. """
    path_parts = path.split("/")
    for (route_method, route_path), handler in _ROUTES.items():
        if method != route_method:
            continue
        route_parts = route_path.split("/")
        if len(route_parts) != len(path_parts):
            continue
        params = {}
        for rp, pp in zip(route_parts, path_parts):
            if rp.startswith("{") and rp.endswith("}"):
                params[rp[1:-1]] = pp
            elif rp != pp:
                break
        else:
            return handler, params
    return None, {}


def lambda_handler(event: dict, context) -> dict:
    method = event.get("httpMethod", "")
    path = event.get("path", "")
    handler, path_params = _match_route(method, path)
    if handler is None:
        return _response(404, {"error": "Not found"})
    try:
        return handler(event, path_params)
    except Exception as exc:
        return _response(500, {"error": str(exc)})


