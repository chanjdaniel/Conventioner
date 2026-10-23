"""Every package the back end installs is pinned, so a deploy of unchanged code changes nothing.

The production redeploy of 2026-10-23 rebuilt unchanged code and still moved six packages, openai
among them, because requirements.txt named most of them with no version at all. Each requirements
file is now a lock compiled from the `.in` file beside it by `scripts/lock-backend-requirements.sh`:
every line one exact version with its hashes, which also makes pip refuse any line that is not.

These tests fail on a lock line that is not a hashed pin, on a lock whose direct requirements are
not exactly its `.in`'s or whose pins no longer satisfy it, and on a package pinned differently in
two locks. A pin changed by hand to another version that still satisfies the `.in` passes them; CI's
`backend` job catches that by re-running the lock command and failing on any difference.
"""

import re
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

BACK_END = Path(__file__).resolve().parent.parent
LOCKS = ["requirements.txt", "requirements-floorplan-solver.txt", "requirements-dev.txt"]

HASH = re.compile(r"\s--hash=sha256:[0-9a-f]{64}")


def _source(lock):
    return lock.replace(".txt", ".in")


def _lock_entries(lock):
    """Each requirement of a compiled lock, as (Requirement, number of hashes, its `# via` sources).

    uv writes a requirement's sources under it, on the `# via` line or one per line after it.
    """
    text = (BACK_END / lock).read_text().replace("\\\n", " ")
    entries = []
    for line in text.splitlines():
        comment = line.strip().startswith("#")
        if comment and entries:
            body = line.strip()[1:].strip()
            if body.startswith("via"):
                body = body[len("via"):].strip()
            if body:
                entries[-1][2].append(body)
        elif not comment and line.strip():
            hashes = len(HASH.findall(" " + line))
            entries.append((Requirement(HASH.sub("", " " + line).strip()), hashes, []))
    return entries


def _pinned_version(req):
    """The one exact version a requirement names, or None if it allows more than one."""
    specs = list(req.specifier)
    return specs[0].version if [spec.operator for spec in specs] == ["=="] else None


def _pins(lock):
    return {canonicalize_name(req.name): _pinned_version(req) for req, _, _ in _lock_entries(lock)}


def _sources(lock):
    """The requirements its `.in` file names, without the `-c` / `-r` lines that join them."""
    text = (BACK_END / _source(lock)).read_text()
    lines = (line.split("#", 1)[0].strip() for line in text.splitlines())
    return [Requirement(line) for line in lines if line and not line.startswith("-")]


@pytest.mark.parametrize("lock", LOCKS)
def test_every_package_is_one_exact_version_with_its_hashes(lock):
    loose = [
        str(req)
        for req, hashes, _ in _lock_entries(lock)
        if hashes == 0 or _pinned_version(req) is None
    ]
    assert not loose, f"{lock} has lines that are not a pin with hashes: {loose}"


@pytest.mark.parametrize("lock", LOCKS)
def test_the_lock_takes_its_direct_requirements_from_its_source_alone(lock):
    direct = {
        canonicalize_name(req.name)
        for req, _, sources in _lock_entries(lock)
        if f"-r {_source(lock)}" in sources
    }
    wanted = {canonicalize_name(req.name) for req in _sources(lock)}
    assert direct == wanted, (
        f"{lock} locks {sorted(direct - wanted)} that {_source(lock)} no longer names and lacks "
        f"{sorted(wanted - direct)} that it does; run scripts/lock-backend-requirements.sh"
    )


@pytest.mark.parametrize("lock", LOCKS)
def test_the_lock_still_satisfies_what_its_source_asks_for(lock):
    pins = _pins(lock)
    stale = []
    for wanted in _sources(lock):
        version = pins.get(canonicalize_name(wanted.name))
        if version is None or not wanted.specifier.contains(version, prereleases=True):
            stale.append(str(wanted))
    assert not stale, (
        f"{lock} no longer matches {_source(lock)} for {stale}; "
        "run scripts/lock-backend-requirements.sh"
    )


def test_a_package_in_two_locks_has_the_same_pin_in_both():
    runtime = _pins("requirements.txt")
    drift = [
        f"{lock}: {name} {version} vs {runtime[name]}"
        for lock in LOCKS[1:]
        for name, version in _pins(lock).items()
        if name in runtime and version != runtime[name]
    ]
    assert not drift, drift
