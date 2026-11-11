"""Every module of the back end imports as the first module of a fresh interpreter (T283).

The suite imports its modules in conftest's order, so a cycle between them can pass every test and
still stop the server at boot, where ``app`` imports them in its own order: ``organization_people``
importing ``history`` at module level did exactly that (``api.market_actions`` reads
``api.permissions``, which reads ``organization_people``, which read ``history``, which reads
``api.market_actions``), and only the E2E stack's boot showed it. Here each module is imported
first, alone, in one fresh interpreter whose back-end modules are forgotten between them, so any
module that can begin an import chain into a cycle is named.

``app`` itself is left out: importing it checks the database at boot, which the suite answers
in-process (conftest), never in a fresh interpreter. Scripts, which act when run, are left out too.
"""
import subprocess
import sys
from pathlib import Path

BACK_END = Path(__file__).resolve().parent.parent

#: Run, never imported by the server.
SCRIPTS = {
    "app", "create_account", "create_test_user", "generate_market_schema", "init_database",
    "reset_database", "seed_test_markets",
}

IMPORT_EACH_FIRST = """
import importlib, sys, traceback
back_end = sys.argv[1]
kept = set(sys.modules)
failed = []
for name in sys.argv[2:]:
    for loaded in [m for m in sys.modules if m not in kept]:
        if (getattr(sys.modules[loaded], "__file__", None) or "").startswith(back_end):
            del sys.modules[loaded]
    try:
        importlib.import_module(name)
    except Exception as error:
        failed.append(f"{name}: {type(error).__name__}: {error}")
print("\\n".join(failed))
sys.exit(1 if failed else 0)
"""


def modules():
    top = [path.stem for path in BACK_END.glob("*.py") if path.stem not in SCRIPTS]
    api = [f"api.{path.stem}" for path in (BACK_END / "api").glob("*.py")
           if path.stem != "__init__"]
    return sorted(top) + sorted(api)


def test_every_module_imports_as_the_first_of_a_fresh_interpreter():
    names = modules()
    assert "organization_people" in names and "api.permissions" in names

    run = subprocess.run(
        [sys.executable, "-c", IMPORT_EACH_FIRST, str(BACK_END), *names],
        cwd=BACK_END, capture_output=True, text=True, timeout=120,
    )

    assert run.returncode == 0, f"These modules do not import first:\n{run.stdout}{run.stderr}"
