#!/usr/bin/env python3
"""Prove Conventioner's Discord bot works over REST alone, with no gateway connection (E46/F01/S02).

The back end is serverless: it cannot hold Discord's gateway open, so the Discord stories rest on
two REST calls working from a plain HTTPS client. Discord's docs say they do (the "REST only" section
of docs/implementation/modules/discord.md cites each); this script is the proof against a real
server. It lists every member of the server (List Guild Members, which needs the Server Members
Intent switched on in the Developer Portal) and gives one member a role (Add Guild Member Role,
which needs Manage Roles and a role below the bot's own), then reads the member back.

It opens no gateway connection and uses only the standard library. The token is read from the
environment and never from an argument, so it stays out of the shell's history; read it in without
echoing it:

    read -rs DISCORD_BOT_TOKEN && export DISCORD_BOT_TOKEN
    python3 scripts/discord_rest_proof.py --server <server id> --role "Vendor Test" --member <username>

It exits 0 when both calls worked, and 1 naming the step that did not.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

API = "https://discord.com/api/v10"
# Discord asks every HTTP client to name itself in this shape.
USER_AGENT = "DiscordBot (https://conventioner.io, 1.0)"
PAGE = 1000

#: method, path, body -> status, parsed body. Replaced by the tests.
Sender = Callable[[str, str, Optional[Dict[str, Any]]], Tuple[int, Any]]


def sender(token: str) -> Sender:
    def send(method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Tuple[int, Any]:
        request = urllib.request.Request(
            API + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Authorization": f"Bot {token}", "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                "X-Audit-Log-Reason": "Conventioner's REST-only proof",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as answer:
                raw = answer.read()
                return answer.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except ValueError:
                return e.code, None
    return send


class Failed(Exception):
    """A step that did not work, said in a line."""


def _expect(step: str, status: int, body: Any, *wanted: int) -> Any:
    if status not in wanted:
        said = body.get("message") if isinstance(body, dict) else None
        raise Failed(f"{step}: Discord answered {status}{f' ({said})' if said else ''}.")
    return body


def all_members(send: Sender, server: str) -> List[Dict[str, Any]]:
    """Every member, a page of up to 1000 at a time, each page after the highest id so far."""
    members: List[Dict[str, Any]] = []
    after = "0"
    while True:
        query = urllib.parse.urlencode({"limit": PAGE, "after": after})
        status, page = send("GET", f"/guilds/{server}/members?{query}", None)
        page = _expect("List Guild Members (is the Server Members Intent on?)", status, page, 200)
        members.extend(page)
        if len(page) < PAGE:
            return members
        after = max((member["user"]["id"] for member in page), key=int)


def prove(send: Sender, server: str, role_name: str, username: str, out=print) -> None:
    status, me = send("GET", "/users/@me", None)
    me = _expect("Get Current User (is the token the bot's?)", status, me, 200)
    out(f"Signed in as the bot {me.get('username')} ({me['id']}), over HTTPS only.")

    members = all_members(send, server)
    out(f"List Guild Members: {len(members)} members.")

    status, roles = send("GET", f"/guilds/{server}/roles", None)
    roles = _expect("Get Guild Roles", status, roles, 200)
    role = next((r for r in roles if r["name"] == role_name), None)
    if role is None:
        raise Failed(f"The server has no role named {role_name!r}.")

    wanted = username.strip().lstrip("@").lower()
    member = next((m for m in members if m["user"]["username"].lower() == wanted), None)
    if member is None:
        raise Failed(f"No member's username is {username!r}.")

    user_id = member["user"]["id"]
    status, body = send("PUT", f"/guilds/{server}/members/{user_id}/roles/{role['id']}", None)
    _expect("Add Guild Member Role (is the bot's role above the role?)", status, body, 204)
    status, after = send("GET", f"/guilds/{server}/members/{user_id}", None)
    after = _expect("Get Guild Member", status, after, 200)
    if role["id"] not in after.get("roles", []):
        raise Failed("Add Guild Member Role answered 204, but the member does not hold the role.")
    out(f"Add Guild Member Role: {username} now holds {role_name}.")
    out("PASS: listing members and giving a role work over REST, with no gateway connection.")


def main(argv: Optional[List[str]] = None, send: Optional[Sender] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--server", required=True, help="the test server's id")
    parser.add_argument("--role", required=True, help='the role to give, by name: "Vendor Test"')
    parser.add_argument("--member", required=True, help="the username of a test account")
    args = parser.parse_args(argv)

    if send is None:
        token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
        if not token:
            print("Set DISCORD_BOT_TOKEN in the environment first (see this script's header).",
                  file=sys.stderr)
            return 1
        send = sender(token)
    try:
        prove(send, args.server, args.role, args.member)
    except Failed as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
