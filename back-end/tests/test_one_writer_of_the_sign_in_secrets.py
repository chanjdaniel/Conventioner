"""``account_secrets`` is the only back-end module that names an account's sign-in secrets
(ADR 0028), so no other code can write them in a way the module's table does not hold.

A scan of every back-end module outside the tests and ``migrations/`` finds no string naming the
``secrets`` field, a path under it, or a legacy field the module still reads, but in
``account_secrets.py``. A request body's ``"otp"``, which ``/login-otp`` reads with
``string_field``, names the field a code is entered in, not a stored one, and is not counted;
neither are docstrings.
"""
import ast
from pathlib import Path

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets

BACK_END = Path(__file__).resolve().parent.parent
OWNER = BACK_END / "account_secrets.py"


def _modules():
    for path in sorted(BACK_END.rglob("*.py")):
        relative = path.relative_to(BACK_END)
        if relative.parts[0] in ("tests", "migrations") or path == OWNER:
            continue
        if any(part.startswith(".") or part in ("venv", "__pycache__") for part in relative.parts):
            continue
        yield path


def _names_a_secret(value: str) -> bool:
    return (value == account_secrets.SECRETS_FIELD
            or value.startswith(f"{account_secrets.SECRETS_FIELD}.")
            or value in account_secrets.LEGACY_FIELDS)


def _docstrings(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                yield body[0].value


def _request_fields(tree):
    """The constants a request body is read by: ``string_field(data, "<name>")``."""
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "string_field"
                and len(node.args) == 2 and isinstance(node.args[1], ast.Constant)):
            yield node.args[1]


def _naming(path):
    """Each string in the module at ``path`` naming a secret, as ``(line, value)``, in order."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    skipped = {id(node) for node in [*_docstrings(tree), *_request_fields(tree)]}
    return sorted(
        (node.lineno, node.value) for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
        and id(node) not in skipped and _names_a_secret(node.value)
    )


def test_no_module_but_account_secrets_names_a_sign_in_secret():
    named = [f"{path.relative_to(BACK_END)}:{line}: {value!r}"
             for path in _modules() for line, value in _naming(path)]

    assert named == []


def test_the_scan_finds_what_it_looks_for(tmp_path):
    """The scan is not vacuous: a write of each name is found, and the request field is not."""
    module = tmp_path / "a_writer.py"
    module.write_text(
        '"""A module naming secrets.code in its docstring."""\n'
        'users.update_one({}, {"$set": {"secrets.code.state": "used"}})\n'
        'users.update_one({}, {"$unset": {"secrets": ""}})\n'
        + "".join(f'users.update_one({{}}, {{"$set": {{"{field}": None}}}})\n'
                  for field in account_secrets.LEGACY_FIELDS)
        + 'otp = string_field(data, "otp")\n'
    )

    assert [value for _line, value in _naming(module)] == [
        "secrets.code.state", "secrets", *account_secrets.LEGACY_FIELDS]
