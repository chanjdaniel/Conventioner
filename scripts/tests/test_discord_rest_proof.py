"""The REST-only proof script (E46/F01/S02), against a fake of Discord's REST API.

The script is run by hand with a real bot token; these pin the calls it makes, that it pages the
member list, and that each failure names its step and never asks for the token as an argument.
"""
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "discord_rest_proof.py"
spec = importlib.util.spec_from_file_location("discord_rest_proof", SCRIPT)
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)

SERVER = "100"
ROLE = {"id": "r-vendor", "name": "Vendor Test"}


def member(user_id, username, roles=()):
    return {"user": {"id": str(user_id), "username": username}, "roles": list(roles)}


class FakeDiscord:
    def __init__(self, members, grant_status=204):
        self.members = members
        self.grant_status = grant_status
        self.calls = []

    def __call__(self, method, path, body):
        self.calls.append((method, path))
        if path == "/users/@me":
            return 200, {"id": "1", "username": "Conventioner"}
        if path.startswith(f"/guilds/{SERVER}/members?"):
            after = int(path.split("after=")[1])
            page = [m for m in self.members if int(m["user"]["id"]) > after][:proof.PAGE]
            return 200, page
        if path == f"/guilds/{SERVER}/roles":
            return 200, [{"id": SERVER, "name": "@everyone"}, ROLE]
        if method == "PUT":
            user_id = path.split("/members/")[1].split("/")[0]
            if self.grant_status == 204:
                next(m for m in self.members if m["user"]["id"] == user_id)["roles"].append(ROLE["id"])
            return self.grant_status, None if self.grant_status == 204 else {"message": "Missing Permissions"}
        if path.startswith(f"/guilds/{SERVER}/members/"):
            user_id = path.rsplit("/", 1)[1]
            return 200, next(m for m in self.members if m["user"]["id"] == user_id)
        return 404, {"message": "Unknown"}


def run(fake, member_name="tester_two"):
    return proof.main(["--server", SERVER, "--role", "Vendor Test", "--member", member_name], fake)


def test_it_lists_the_members_and_gives_the_role(capsys):
    fake = FakeDiscord([member(2, "tester_one"), member(3, "tester_two")])

    assert run(fake) == 0
    assert ("PUT", f"/guilds/{SERVER}/members/3/roles/r-vendor") in fake.calls
    assert "PASS" in capsys.readouterr().out


def test_it_pages_past_a_thousand_members(capsys):
    fake = FakeDiscord([member(n, f"tester_{n}") for n in range(2, 1503)])

    assert run(fake, "tester_1502") == 0
    assert sum(1 for _m, path in fake.calls if "/members?" in path) == 2
    assert "1501 members" in capsys.readouterr().out


def test_a_refused_grant_names_its_step(capsys):
    fake = FakeDiscord([member(2, "tester_two")], grant_status=403)

    assert run(fake) == 1
    assert "Add Guild Member Role" in capsys.readouterr().err


def test_a_member_not_in_the_server_is_said_so(capsys):
    assert run(FakeDiscord([member(2, "tester_one")])) == 1
    assert "No member's username" in capsys.readouterr().err


def test_the_token_is_never_an_argument(monkeypatch, capsys):
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)

    assert proof.main(["--server", SERVER, "--role", "Vendor Test", "--member", "x"]) == 1
    assert "DISCORD_BOT_TOKEN" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        proof.main(["--token", "abc", "--server", SERVER, "--role", "r", "--member", "x"])
