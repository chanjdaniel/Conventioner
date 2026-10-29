"""The synthetic Google Form exports are exactly what their generator makes.

``tests/fixtures/synthetic_form_exports.py`` describes each form and writes it; a committed file is
never edited by hand. So a file that differs from the generator's output by one byte - pasted
in, hand-edited, or left behind when the description changed - fails here, and the fix is to
change the description and run the generator again.
"""
import importlib.util
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "fixtures", "synthetic_form_exports.py")

_spec = importlib.util.spec_from_file_location("synthetic_form_exports", SCRIPT)
generator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generator)

FORMS = {form.file: form for form in generator.FORMS}


@pytest.mark.parametrize("name", FORMS)
def test_the_committed_file_is_the_generators_output(name):
    with open(os.path.join(generator.CORPUS, name), "rb") as handle:
        committed = handle.read()
    assert committed == FORMS[name].bytes(), (
        f"{name} is not what tests/fixtures/synthetic_form_exports.py makes: change the form's "
        "description there and run the generator, never the file")


@pytest.mark.parametrize("name", FORMS)
def test_generating_twice_gives_the_same_bytes(name):
    assert FORMS[name].bytes() == FORMS[name].bytes()


@pytest.mark.parametrize("name", FORMS)
def test_it_is_written_as_google_sheets_exports_it(name):
    """UTF-8 with no byte order mark, CRLF between records, LF inside a header cell, a final
    newline: what the proposal and the import are handed by a real download."""
    data = FORMS[name].bytes()
    assert not data.startswith(b"\xef\xbb\xbf")
    assert data.endswith(b"\r\n")
    header = data[:data.index(b"\r\n")]
    assert b"\n" in header and b"\r" not in header
