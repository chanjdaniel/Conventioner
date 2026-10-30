"""real_data_check.py, run as the hooks, the gate and CI run it: against a git repository of the
test's own, on fake data only. The "real export" here is a CSV the test writes into that
repository's ignored .scratch/examples/."""

import csv
import hashlib
import importlib.util
import io
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

REPO = Path(__file__).resolve().parents[2]
CHECKER = REPO / "scripts" / "real_data_check.py"
BASH = shutil.which("bash")


def at(local, domain):
    """An address, built at run time: written out, the hooks would refuse this file."""
    return f"{local}@{domain}"


# Invented, in the shapes the checker refuses.
GMAIL = at("jordan.vance88", "gmail.com")
REAL_PHONE = ("604", "382", "7719")

# A fake export in the shape of a Google Form's: one applicant who looks entirely like a fixture,
# so only the exact-value check can catch them, and three who share a placeholder name.
FAKE_EXPORT = """\
Timestamp,Email Address,Full name,Business name,Phone number
9/27/2025 9:04:01,wren.okafor@example.com,Wren Okafor,Ember Kiln Pottery,(604) 555-0142
9/27/2025 9:05:12,a@example.org,Not Applicable,Shop A,
9/27/2025 9:06:40,b@example.org,Not Applicable,Shop B,
9/27/2025 9:07:03,c@example.org,Not Applicable,Shop C,
"""


def git(cwd, *args, check=True, **kwargs):
    return subprocess.run(["git", *args], cwd=cwd, check=check, text=True, capture_output=True, **kwargs)


def make_repo(path):
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "dev")
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "test@example.com")
    git(path, "config", "commit.gpgsign", "false")
    (path / ".gitignore").write_text(".scratch/\n")
    (path / "README.md").write_text("A repository of the test's own.\n")
    git(path, "add", ".")
    git(path, "commit", "-q", "-m", "chore: start")
    return path


@pytest.fixture
def repo(tmp_path):
    return make_repo(tmp_path / "repo")


def check(repo, *args, stdin=None):
    return subprocess.run(
        [sys.executable, str(CHECKER), *args],
        cwd=repo,
        input=stdin,
        text=True,
        capture_output=True,
    )


def stage(repo, name, text):
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    git(repo, "add", "-f", name)


def commit(repo, name, text, message="test: add a file"):
    stage(repo, name, text)
    git(repo, "commit", "-q", "--no-verify", "-m", message)
    return git(repo, "rev-parse", "HEAD").stdout.strip()


def with_fake_export(repo):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.csv").write_text(FAKE_EXPORT)


def xlsx(rows, shared=True):
    """A minimal workbook as Excel writes one: text in xl/sharedStrings.xml, or inline in the
    sheet's XML when not `shared`."""
    strings, cells = [], []
    for r, row in enumerate(rows, 1):
        out = []
        for c, value in enumerate(row):
            ref = f"{chr(65 + c)}{r}"
            if shared:
                strings.append(value)
                out.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
            else:
                out.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        cells.append(f'<row r="{r}">{"".join(out)}</row>')
    main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as book:
        book.writestr("[Content_Types].xml", "<Types/>")
        book.writestr("xl/workbook.xml", f"<workbook {main}><sheets/></workbook>")
        book.writestr("xl/worksheets/sheet1.xml", f"<worksheet {main}><sheetData>{''.join(cells)}</sheetData></worksheet>")
        if shared:
            items = "".join(f"<si><t>{escape(v)}</t></si>" for v in strings)
            book.writestr("xl/sharedStrings.xml", f'<sst {main} count="{len(strings)}">{items}</sst>')
    return data.getvalue()


def ods(rows):
    """A minimal OpenDocument spreadsheet: its cells in content.xml, an empty run of cells repeated."""
    table = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    body = "".join(
        "<table:table-row>"
        + '<table:table-cell table:number-columns-repeated="2"/>'
        + "".join(f"<table:table-cell><text:p>{escape(v)}</text:p></table:table-cell>" for v in row)
        + "</table:table-row>"
        for row in rows
    )
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as sheet:
        sheet.writestr("mimetype", "application/vnd.oasis.opendocument.spreadsheet")
        sheet.writestr(
            "content.xml",
            f'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
            f'xmlns:table="{table}" xmlns:text="{text}"><office:body><office:spreadsheet>'
            f'<table:table table:name="Responses">{body}</table:table>'
            "</office:spreadsheet></office:body></office:document-content>",
        )
    return data.getvalue()


def stage_bytes(repo, name, data):
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    git(repo, "add", "-f", name)


FAKE_ROWS = list(csv.reader(io.StringIO(FAKE_EXPORT)))


# --- Shapes ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        f'email = "{GMAIL}"',
        f"Contact: Jordan <{at('jordan.vance88', 'hotmail.ca')}>",
        f"{at('jordan', 'kilnandco.ca')} wrote in",
        # Registrable domains a fixture once used: each is somebody's real inbox.
        f"write to {at('their', 'email.com')}",
        f"{at('nadia', 'ember.ca')}",
        f"{at('dan', 'x.com')}",
        f"{at('user', '3m.com')}",
        f"{at('user', '1password.com')}",
    ],
)
def test_an_address_outside_the_fixture_domains_fails(repo, line):
    stage(repo, "notes/contacts.txt", f"first\n{line}\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes/contacts.txt:2:" in result.stdout
    assert "email address outside the fixture domains" in result.stdout


@pytest.mark.parametrize("domain", ["company.md", "company.py", "company.map"])
def test_an_address_at_a_real_tld_fails(repo, domain):
    stage(repo, "notes/contacts.txt", f"first\n{at('person', domain)}\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes/contacts.txt:2:" in result.stdout
    assert "email address outside the fixture domains" in result.stdout


@pytest.mark.parametrize(
    "address",
    [
        "vendor@example.com",
        "Organizer@Example.COM",
        "a@sub.example.org",
        "nadia@ember.test",
        "owner@market.test",
        "registration@conventioner.io",
        "onboarding@resend.dev",
        "12345+someone@users.noreply.github.com",
    ],
)
def test_a_fixture_address_passes(repo, address):
    stage(repo, "tests/test_people.py", f'EMAIL = "{address}"\n')

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout
    assert result.stdout == ""


@pytest.mark.parametrize("text", ["logo@2x.png", "actions/checkout@v5", "vue@3.5.13", "@primevue/themes"])
def test_what_only_looks_like_an_address_passes(repo, text):
    stage(repo, "notes.md", f"{text}\n")

    assert check(repo, "staged").returncode == 0


@pytest.mark.parametrize(
    "phone",
    [shape.format(*REAL_PHONE) for shape in ("({}) {}-{}", "{}-{}-{}", "+1 {} {} {}", "{}.{}.{}")]
    # The 555 exchange outside 0100 to 0199 can be assigned.
    + ["{}-{}-{}".format("778", "555", "1234"), "({}) {}-{}".format("604", "555", "0200")],
)
def test_a_phone_number_shaped_like_a_real_one_fails(repo, phone):
    stage(repo, "notes.md", f"Call {phone} after six\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes.md:1:" in result.stdout
    assert "phone number" in result.stdout


@pytest.mark.parametrize(
    "text",
    [
        "(604) 555-0123",
        "604-555-0199",
        "+1 604 555 0100",
        "sha256:2a7f3b9e{}{}{}12ab".format(*REAL_PHONE),
        "timestamp 1729728000123",
        "ids {}{}{} and 2026102412".format(*REAL_PHONE),
    ],
)
def test_a_fixture_phone_or_a_bare_number_passes(repo, text):
    stage(repo, "notes.md", f"{text}\n")

    assert check(repo, "staged").returncode == 0, check(repo, "staged").stdout


def atlas(*labels):
    """A MongoDB Atlas host, built at run time: written out, the hooks would refuse this file."""
    return ".".join((*labels, "mongodb", "net"))


# Invented, in the shape of a real cluster's: its id is what names it.
ATLAS_ID = "q7x2kd"


@pytest.mark.parametrize(
    "line",
    [
        f"| Database | cluster `market-prod` | `{atlas('market-prod', ATLAS_ID)}` |",
        f"MONGODB_URI=mongodb+srv://{atlas('market-prod', ATLAS_ID)}/conventioner",
        f"{atlas('ac-m3pz9qe-shard-00-01', ATLAS_ID)}:27017",
        atlas("Market-Prod", ATLAS_ID.upper()),
        # A placeholder name keeps nothing back when the id beside it is real.
        atlas("cluster", ATLAS_ID),
    ],
)
def test_a_mongodb_atlas_host_fails(repo, line):
    stage(repo, "docs/ops.md", f"first\n{line}\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "docs/ops.md:2:" in result.stdout
    assert "MongoDB Atlas host" in result.stdout
    assert ATLAS_ID not in result.stdout.lower() and "market-prod" not in result.stdout.lower()


@pytest.mark.parametrize(
    "line",
    [
        "| Database | `<cluster>.<id>.mongodb.net` |",
        "# Format: mongodb+srv://username:password@cluster.mongodb.net/conventioner",
        "mongodb+srv://cluster0.example.mongodb.net/conventioner",
        "Atlas serves every cluster under *.mongodb.net, and mongodb.net is MongoDB's.",
    ],
)
def test_a_placeholder_mongodb_host_passes(repo, line):
    stage(repo, "docs/ops.md", f"{line}\n")

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout


def test_no_matched_value_is_printed_in_full(repo):
    stage(repo, "notes.md", "{}\n({}) {}-{}\n".format(GMAIL, *REAL_PHONE))

    result = check(repo, "staged")

    out = result.stdout + result.stderr
    assert result.returncode == 1
    assert "jordan.vance88" not in out and "gmail.com" not in out
    assert REAL_PHONE[1] not in out and REAL_PHONE[2] not in out


def test_only_added_lines_count(repo):
    commit(repo, "old.md", f"{GMAIL}\n")
    git(repo, "rm", "-q", "old.md")

    assert check(repo, "staged").returncode == 0


def test_a_generated_lockfile_is_not_read(repo):
    stage(repo, "front-end/package-lock.json", f'"deprecated": "ask {at("i", "izs.me")}"\n')

    assert check(repo, "staged").returncode == 0


# --- The real exports --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "applicant: wren.okafor@example.com",
        "phone 604 555 0142",
        "6045550142",
        "{'name': 'Wren   Okafor', 'table': 4}",
        "WREN OKAFOR, Pottery",
    ],
)
def test_an_exact_value_from_a_real_export_fails(repo, line):
    with_fake_export(repo)
    stage(repo, "back-end/tests/test_data/sample.csv", f"header\n{line}\n")

    result = check(repo, "staged")

    out = result.stdout + result.stderr
    assert result.returncode == 1
    assert "back-end/tests/test_data/sample.csv:2:" in result.stdout
    assert "real export" in result.stdout
    for value in ("wren", "okafor", "0142"):
        assert value not in out.lower()


def test_a_line_with_an_exact_phone_still_reports_another_real_shaped_phone(repo):
    with_fake_export(repo)
    stage(repo, "notes.md", "Call (604) 555-0142 or ({}) {}-{}\n".format(*REAL_PHONE))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "real export" in result.stdout
    assert "phone number shaped like a real one" in result.stdout


@pytest.mark.parametrize(
    "line",
    [
        "Wren is a fine name",  # one word of a name
        "not applicable",  # three applicants gave it: it identifies nobody
        "Ember Kiln Pottery",  # a business, not a person
        "owren.okafor@example.com",  # another address
    ],
)
def test_what_does_not_name_an_applicant_passes(repo, line):
    with_fake_export(repo)
    stage(repo, "notes.md", f"{line}\n")

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout


def test_a_forced_add_of_the_export_itself_fails(repo):
    with_fake_export(repo)
    git(repo, "add", "-f", ".scratch/examples/responses.csv")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert ".scratch/examples/responses.csv:2:" in result.stdout


def test_a_worktree_reads_the_primary_checkouts_exports(repo, tmp_path):
    with_fake_export(repo)
    worktree = tmp_path / "worktree"
    git(repo, "worktree", "add", "-q", str(worktree), "-b", "feature")
    stage(worktree, "notes.md", "wren.okafor@example.com\n")

    result = check(worktree, "staged")

    assert result.returncode == 1
    assert "real export" in result.stdout


def test_nothing_is_written_while_reading_the_exports(repo):
    with_fake_export(repo)
    stage(repo, "notes.md", "wren.okafor@example.com\n")
    before = sorted(p for p in repo.rglob("*") if ".git" not in p.parts)

    check(repo, "staged")

    assert sorted(p for p in repo.rglob("*") if ".git" not in p.parts) == before


# --- Spreadsheets ------------------------------------------------------------------------------


@pytest.mark.parametrize("shared", [True, False], ids=["shared strings", "inline strings"])
def test_a_workbook_holding_a_real_shaped_address_fails(repo, shared):
    stage_bytes(repo, "notes/vendors.xlsx", xlsx([["Email Address", "Name"], [GMAIL, "Jordan Vance"]], shared))

    result = check(repo, "staged")

    out = result.stdout + result.stderr
    assert result.returncode == 1
    assert "notes/vendors.xlsx" in result.stdout
    assert "email address outside the fixture domains" in result.stdout
    assert "jordan.vance88" not in out and "gmail.com" not in out


def test_a_shared_string_no_cell_shows_is_still_read(repo):
    book = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(xlsx([["Email Address"], ["vendor@example.com"]]))) as source:
        with zipfile.ZipFile(book, "w") as target:
            for entry in source.infolist():
                data = source.read(entry.filename)
                if entry.filename == "xl/sharedStrings.xml":
                    data = data.replace(b"</sst>", f"<si><t>{GMAIL}</t></si></sst>".encode())
                target.writestr(entry, data)
    stage_bytes(repo, "vendors.xlsx", book.getvalue())

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "vendors.xlsx [shared string 3]" in result.stdout


def test_a_workbook_of_fixture_addresses_passes(repo):
    stage_bytes(repo, "back-end/tests/test_data/vendors.xlsx", xlsx([["Email Address"], ["vendor@example.com"]]))

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout


def test_an_opendocument_sheet_holding_a_real_shaped_address_fails(repo):
    stage_bytes(repo, "vendors.ods", ods([["Email Address"], [GMAIL]]))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "vendors.ods" in result.stdout


def test_an_opendocument_sheet_of_fixture_addresses_passes(repo):
    stage_bytes(repo, "vendors.ods", ods([["Email Address"], ["vendor@example.com"]]))

    assert check(repo, "staged").returncode == 0


def test_a_workbook_holding_an_exact_value_from_a_real_export_fails(repo):
    with_fake_export(repo)
    stage_bytes(repo, "notes/copy.xlsx", xlsx([["Who"], ["Wren Okafor"]]))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "real export" in result.stdout


@pytest.mark.parametrize("kind", ["xlsx", "ods"])
def test_a_spreadsheet_export_is_read_for_its_exact_values(repo, kind):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / f"responses.{kind}").write_bytes(xlsx(FAKE_ROWS) if kind == "xlsx" else ods(FAKE_ROWS))
    stage(repo, "notes.md", "wren.okafor@example.com\nWren Okafor\nphone 6045550142\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    for line in (1, 2, 3):
        assert f"notes.md:{line}: " in result.stdout, result.stdout


@pytest.mark.parametrize("name", ["vendors.xls", "notes/vendors.xlsb", "vendors.numbers"])
def test_a_spreadsheet_the_check_cannot_read_is_refused_outright(repo, name):
    stage_bytes(repo, name, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512)

    result = check(repo, "staged")

    assert result.returncode == 1
    assert f"{name}:" in result.stdout
    assert "cannot read" in result.stdout


def test_a_spreadsheet_the_check_cannot_read_passes_under_the_test_fixtures(repo):
    stage_bytes(repo, "back-end/tests/test_data/legacy.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512)

    assert check(repo, "staged").returncode == 0


def test_a_broken_workbook_is_refused(repo):
    stage_bytes(repo, "vendors.xlsx", b"PK\x03\x04 not really a workbook \x00")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "cannot read" in result.stdout


def test_a_workbook_with_a_corrupt_member_is_refused(repo):
    book = bytearray(xlsx([["Email Address"], ["vendor@example.com"]]))
    with zipfile.ZipFile(io.BytesIO(bytes(book))) as source:
        info = source.getinfo("xl/sharedStrings.xml")
        name_len = int.from_bytes(book[info.header_offset + 26:info.header_offset + 28], "little")
        extra_len = int.from_bytes(book[info.header_offset + 28:info.header_offset + 30], "little")
        size = int.from_bytes(book[info.header_offset + 18:info.header_offset + 22], "little")
        start = info.header_offset + 30 + name_len + extra_len
        for i in range(start + 4, start + size - 1, 3):
            book[i] ^= 0xFF
    stage_bytes(repo, "vendors.xlsx", bytes(book))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "cannot read" in result.stdout
    assert "Traceback" not in result.stdout + result.stderr


def test_a_csv_git_reads_as_binary_is_read_as_text(repo):
    stage_bytes(repo, "export.csv", f"Email Address\n{GMAIL}\n".encode("utf-16"))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "export.csv:2:" in result.stdout


def test_other_binary_files_pass(repo):
    stage_bytes(repo, "front-end/public/logo.png", b"\x89PNG\r\n\x1a\n\x00\x00" + GMAIL.encode())

    assert check(repo, "staged").returncode == 0


def test_a_range_reads_a_workbook_a_commit_added(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    stage_bytes(repo, "vendors.xlsx", xlsx([["Email Address"], [GMAIL]]))
    git(repo, "commit", "-q", "--no-verify", "-m", "docs: vendors")
    sha = git(repo, "rev-parse", "HEAD").stdout.strip()

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 1
    assert f"{sha[:12]} vendors.xlsx" in result.stdout


def test_a_merge_answers_for_a_workbook_it_changed_itself(repo):
    git(repo, "checkout", "-q", "-b", "side")
    stage_bytes(repo, "vendors.xlsx", xlsx([["Email Address"], [GMAIL]]))
    git(repo, "commit", "-q", "--no-verify", "-m", "docs: vendors")
    git(repo, "checkout", "-q", "dev")
    commit(repo, "main.md", "fine\n")
    git(repo, "merge", "-q", "--no-ff", "--no-edit", "side")

    result = check(repo, "commits", "HEAD", "--not", "HEAD^1", "HEAD^2")

    assert result.returncode == 0, result.stdout


def zipped(members):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return data.getvalue()


# --- Archives -----------------------------------------------------------------------------------


def test_a_zip_is_read_for_the_spreadsheets_it_holds(repo):
    # Google Forms' "Download responses" saves exactly this: a zip holding the CSV.
    stage_bytes(repo, "notes/responses.zip", zipped({"Form (Responses).csv": f"Email Address\n{GMAIL}\n"}))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes/responses.zip > Form (Responses).csv:2:" in result.stdout


def test_a_zip_of_fixture_data_or_of_no_spreadsheet_passes(repo):
    stage_bytes(repo, "a.zip", zipped({"Form (Responses).csv": "Email Address\nvendor@example.com\n"}))
    stage_bytes(repo, "icons.zip", zipped({"logo.png": b"\x89PNG\r\n\x1a\n" + GMAIL.encode()}))

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout


def test_a_zip_holding_a_spreadsheet_the_check_cannot_read_is_refused(repo):
    stage_bytes(repo, "old.zip", zipped({"responses.xls": b"\xd0\xcf\x11\xe0" + b"\x00" * 64}))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "old.zip > responses.xls" in result.stdout and "cannot read" in result.stdout


@pytest.mark.parametrize("name", ["responses.csv.gz", "backup.tar.gz", "responses.7z", "dump.tgz"])
def test_an_archive_the_check_cannot_read_is_refused_outright(repo, name):
    stage_bytes(repo, name, b"\x1f\x8b\x08\x00" + b"\x00" * 64)

    result = check(repo, "staged")

    assert result.returncode == 1
    assert f"{name}:" in result.stdout and "cannot read" in result.stdout


def test_an_archive_the_check_cannot_read_passes_under_the_test_fixtures(repo):
    stage_bytes(repo, "back-end/tests/fixtures/sample.csv.gz", b"\x1f\x8b\x08\x00" + b"\x00" * 64)

    assert check(repo, "staged").returncode == 0


def test_a_zipped_export_is_read_for_its_exact_values(repo):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.zip").write_bytes(zipped({"Form (Responses).csv": FAKE_EXPORT}))
    stage(repo, "notes.md", "Wren Okafor\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes.md:1:" in result.stdout


def test_an_export_the_check_read_nothing_from_is_named_on_stderr_by_kind_only(repo):
    with_fake_export(repo)
    examples = repo / ".scratch" / "examples"
    (examples / "Wren Okafor answers.pdf").write_bytes(b"%PDF-1.4 " + b"\x00" * 64)
    (examples / "older responses.csv.gz").write_bytes(b"\x1f\x8b\x08\x00" + b"\x00" * 64)
    stage(repo, "notes.md", "fine\n")

    result = check(repo, "staged")

    assert result.returncode == 0
    assert "read nothing from 2 files in .scratch/examples/ (.gz, .pdf)" in result.stderr
    assert "wren" not in result.stderr.lower() and "older" not in result.stderr


def test_exports_it_reads_say_nothing(repo):
    with_fake_export(repo)
    stage(repo, "notes.md", "fine\n")

    assert check(repo, "staged").stderr == ""


# --- Exports re-saved by a spreadsheet app --------------------------------------------------


def test_a_semicolon_delimited_export_is_read_for_names(repo):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.csv").write_text(FAKE_EXPORT.replace(",", ";"))
    stage(repo, "notes.md", "Wren Okafor\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "applicant's name" in result.stdout


@pytest.mark.parametrize("encoding", ["utf-8", "cp1252"])
def test_a_cp1252_export_keeps_its_accented_names_whole(repo, encoding):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.csv").write_bytes(FAKE_EXPORT.replace("Wren Okafor", "Hésketty Marlow").encode("cp1252"))
    stage_bytes(repo, "notes.md", "Hésketty Marlow\n".encode(encoding))

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes.md:1: an applicant's name" in result.stdout


def test_an_accented_name_is_not_matched_by_a_part_of_it(repo):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.csv").write_bytes(FAKE_EXPORT.replace("Wren Okafor", "Hésketty Marlow").encode("cp1252"))
    stage(repo, "notes.md", "sketty Marlow\n")

    assert check(repo, "staged").returncode == 0


# --- The generator's output --------------------------------------------------------------------


def test_the_synthetic_corpus_passes_the_check(repo):
    """Every file the corpus generator writes is staged as it is committed, and passes."""
    script = REPO / "back-end" / "tests" / "fixtures" / "synthetic_form_exports.py"
    spec = importlib.util.spec_from_file_location("synthetic_form_exports", script)
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    for form in generator.FORMS:
        stage_bytes(repo, form.file, form.bytes())

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout


def test_a_refusal_sends_a_fixture_to_the_generator_never_to_a_real_export(repo):
    stage(repo, "fixture.csv", f"Email Address\n{GMAIL}\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "A real export never becomes test data in any form" in result.stdout
    assert "back-end/tests/fixtures/synthetic_form_exports.py" in result.stdout


# --- The real names ----------------------------------------------------------------------------

# Invented, in place of the real names the committed list holds.
LISTED = "Brindlewick Lantern Guild"
LISTED_HASH = hashlib.sha256(b"brindlewick lantern guild").hexdigest()
TERMS = "scripts/real_data_terms.txt"
NAMED = f"a real organization's, market's, place's or group's name (listed in {TERMS})"


def own_check(repo, *args, stdin=None):
    """The checker copied into the test's repository, so it reads the list beside it there."""
    return subprocess.run(
        [sys.executable, str(repo / "scripts" / "real_data_check.py"), *args],
        cwd=repo,
        input=stdin,
        text=True,
        capture_output=True,
    )


def with_own_checker(repo):
    (repo / "scripts").mkdir(exist_ok=True)
    shutil.copy2(CHECKER, repo / "scripts" / "real_data_check.py")


@pytest.fixture
def listed(repo):
    """The test's repository with the checker and a list of its own, which holds LISTED."""
    with_own_checker(repo)
    added = own_check(repo, "add-term", stdin=f"{LISTED}\n")
    assert added.returncode == 0, added.stdout + added.stderr
    git(repo, "add", "scripts")
    git(repo, "commit", "-q", "--no-verify", "-m", "chore: the checker and its list")
    return repo


def says_no_name(result):
    return "brindlewick" not in (result.stdout + result.stderr).lower()


def test_a_listed_name_in_a_staged_line_is_refused_without_being_said(listed):
    stage(listed, "back-end/tests/test_market.py", f'first\nMARKET = "the {LISTED} spring fair"\n')

    result = own_check(listed, "staged")

    assert result.returncode == 1
    assert f"back-end/tests/test_market.py:2: {NAMED}" in result.stdout
    assert says_no_name(result)


def test_a_listed_name_is_refused_in_a_range_its_lines_and_its_messages(listed):
    base = git(listed, "rev-parse", "HEAD").stdout.strip()
    sha = commit(listed, "notes.md", f"{LISTED}\n", message=f"test: add the {LISTED} fixture")

    result = own_check(listed, "commits", "HEAD", "--not", base)

    assert result.returncode == 1
    assert f"{sha[:12]} notes.md:1: {NAMED}" in result.stdout
    assert f"{sha[:12]} message:1: {NAMED}" in result.stdout
    assert says_no_name(result)


def test_a_listed_name_is_refused_in_a_push(listed):
    head = commit(listed, "notes.md", f"fine\n{LISTED}\n")

    result = own_check(listed, "pre-push", "origin", stdin=f"HEAD {head} refs/heads/feature {'0' * 40}\n")

    assert result.returncode == 1
    assert f"{head[:12]} notes.md:2: {NAMED}" in result.stdout


def test_a_listed_name_in_a_spreadsheets_cell_is_refused(listed):
    stage_bytes(listed, "back-end/tests/test_data/form.xlsx", xlsx([["Club"], [f"{LISTED} members"]]))

    result = own_check(listed, "staged")

    assert result.returncode == 1
    assert f"form.xlsx [sheet 1, row 2, column 1]: {NAMED}" in result.stdout


@pytest.mark.parametrize(
    "name", ["README.md", "CHANGELOG.md", "docs/records/MVP_TEST_RUN_2026-11-01.md", TERMS]
)
def test_a_listed_name_passes_where_the_real_market_may_be_named(listed, name):
    stage(listed, name, f"{LISTED}\n")

    result = own_check(listed, "staged")

    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize("name", ["back-end/tests/test_data/README.md", "docs/README.md", "records/notes.md"])
def test_a_listed_name_is_refused_in_any_other_readme_or_records_folder(listed, name):
    stage(listed, name, f"{LISTED}\n")

    assert own_check(listed, "staged").returncode == 1


@pytest.mark.parametrize(
    "line",
    [
        "BRINDLEWICK LANTERN GUILD",
        "brindlewick  lantern\tguild",
        "the brindlewick-lantern-guild handle",
        "@brindlewick.lantern_guild",
        "Brindlewick Lantern Guild's table",
        "Brindlewick, Lantern, Guild",
        "Ｂrindlewick Lantern Guild",  # a fullwidth letter, which NFKC makes plain
        "Brindlewick Lantern Guild2026",
    ],
)
def test_a_listed_name_matches_however_it_is_cased_spaced_or_punctuated(listed, line):
    stage(listed, "notes.md", f"{line}\n")

    assert own_check(listed, "staged").returncode == 1


@pytest.mark.parametrize(
    "line",
    [
        "Brindlewick Lanterns Guild",
        "Brindlewick Lantern",
        "BrindlewickLanternGuild",
        "Brindlewick Lantern Guildhall",
        "Brindlewick Lantern Market Guild",
    ],
)
def test_a_listed_names_words_inside_longer_words_or_apart_pass(listed, line):
    stage(listed, "notes.md", f"{line}\n")

    result = own_check(listed, "staged")

    assert result.returncode == 0, result.stdout


def test_add_term_lists_a_name_by_its_hash_and_prints_only_the_count(repo):
    with_own_checker(repo)

    result = own_check(repo, "add-term", stdin=f"{LISTED}\nBrindlewick Gardens\n")

    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout == "real-data-check: the list holds 2 names\n"
    assert says_no_name(result)
    written = (repo / TERMS).read_text()
    assert LISTED_HASH in written.split()
    assert "brindlewick" not in written.lower()


def test_add_term_keeps_the_lists_comments_and_counts_only_hashes(repo):
    with_own_checker(repo)
    (repo / TERMS).write_text("# What the list is.\n\n")

    result = own_check(repo, "add-term", stdin=f"{LISTED}\n")

    assert result.stdout == "real-data-check: the list holds 1 name\n"
    assert (repo / TERMS).read_text() == f"# What the list is.\n\n{LISTED_HASH}\n"


@pytest.mark.parametrize(
    "stdin, why",
    [
        (f"{LISTED.upper()}\n", "line 1 is listed already"),
        (f"Brindlewick Gardens\n{LISTED}\n", "line 2 is listed already"),
        ("Brindlewick Gardens\nbrindlewick, gardens\n", "line 2 is listed already"),
        ("", "no name on standard input"),
        ("Brindlewick Gardens\n\n", "line 2 has no words"),
        ("--- 2026 ---\n", "line 1 has no words"),
        ("one two three four five six seven\n", "line 1 has more than 6 words"),
    ],
)
def test_add_term_refuses_a_listed_empty_or_long_name_and_adds_nothing(listed, stdin, why):
    before = (listed / TERMS).read_text()

    result = own_check(listed, "add-term", stdin=stdin)

    assert result.returncode == 1
    assert why in result.stderr
    assert says_no_name(result) and "gardens" not in result.stdout + result.stderr
    assert (listed / TERMS).read_text() == before


def test_the_committed_list_holds_only_hashes_and_comments():
    lines = (REPO / TERMS).read_text().splitlines()

    hashes = [line for line in lines if line.strip() and not line.startswith("#")]

    assert hashes, "the list holds no name"
    assert all(re.fullmatch(r"[0-9a-f]{64}", line) for line in hashes)
    assert len(set(hashes)) == len(hashes)


# --- Commits -----------------------------------------------------------------------------------


def test_a_range_names_the_commit_that_added_a_value_even_when_a_later_one_removed_it(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    added = commit(repo, "notes.md", f"{GMAIL}\n")
    git(repo, "rm", "-q", "notes.md")
    git(repo, "commit", "-q", "--no-verify", "-m", "chore: remove it")

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 1
    assert f"{added[:12]} notes.md:1:" in result.stdout


def test_a_range_reads_commit_messages(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    sha = commit(repo, "notes.md", "fine\n", message=f"fix: reply to {GMAIL}\n\nDetails.")

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 1
    assert f"{sha[:12]} message:1:" in result.stdout


def test_a_clean_range_passes(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    commit(repo, "notes.md", "vendor@example.com\n(604) 555-0123\n")

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 0, result.stdout


def test_a_merge_is_held_to_what_it_adds_itself(repo):
    git(repo, "checkout", "-q", "-b", "side")
    commit(repo, "side.md", f"{GMAIL}\n")
    git(repo, "checkout", "-q", "dev")
    commit(repo, "main.md", "fine\n")
    git(repo, "merge", "-q", "--no-ff", "--no-edit", "side")

    clean = check(repo, "commits", "HEAD", "--not", "HEAD^1", "HEAD^2")
    git(repo, "rm", "-q", "--cached", "side.md")
    (repo / "side.md").write_text(f"{GMAIL}\n{at('more', 'hotmail.com')}\n")
    git(repo, "add", "side.md")
    git(repo, "commit", "-q", "--amend", "--no-edit", "--no-verify")
    evil = check(repo, "commits", "HEAD", "--not", "HEAD^1", "HEAD^2")

    assert clean.returncode == 0, clean.stdout
    assert evil.returncode == 1
    assert "side.md:2:" in evil.stdout
    assert "side.md:1:" not in evil.stdout


def test_a_bad_revision_is_an_error_not_a_pass(repo):
    result = check(repo, "commits", "HEAD", "--not", "origin/nowhere")

    assert result.returncode == 2


# --- The hooks and the setup step --------------------------------------------------------------


@pytest.fixture
def hooked(tmp_path):
    """A clone of a repository with the committed hooks and checker, set up by treehouse-setup.sh,
    and a bare remote it pushes to."""
    origin = make_repo(tmp_path / "origin-src")
    for path in (".githooks", "scripts/real_data_check.py", "scripts/treehouse-setup.sh"):
        source = REPO / path
        target = origin / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)
    git(origin, "add", ".")
    git(origin, "commit", "-q", "-m", "chore: hooks")
    remote = tmp_path / "remote.git"
    git(tmp_path, "clone", "-q", "--bare", str(origin), str(remote))
    clone = tmp_path / "clone"
    git(tmp_path, "clone", "-q", str(remote), str(clone))
    git(clone, "config", "user.name", "Test")
    git(clone, "config", "user.email", "test@example.com")
    git(clone, "config", "commit.gpgsign", "false")
    (clone / "front-end" / "node_modules").mkdir(parents=True)  # so setup installs nothing
    setup = subprocess.run(
        [BASH, "scripts/treehouse-setup.sh"],
        cwd=clone,
        env={"PATH": shutil.which("git").rsplit("/", 1)[0] + ":/usr/bin:/bin", "TREEHOUSE_DIR": str(clone)},
        text=True,
        capture_output=True,
    )
    assert setup.returncode == 0, setup.stdout + setup.stderr
    return clone


def test_the_setup_step_installs_the_hooks(hooked):
    assert git(hooked, "config", "core.hooksPath").stdout.strip() == ".githooks"


def test_the_pre_commit_hook_refuses_a_real_shaped_address(hooked):
    stage(hooked, "notes.md", f"{GMAIL}\n")

    result = git(hooked, "commit", "-m", "docs: notes", check=False)

    assert result.returncode != 0
    assert "notes.md:1:" in result.stdout + result.stderr
    assert git(hooked, "log", "-1", "--format=%s").stdout.strip() == "chore: hooks"


def test_the_pre_push_hook_refuses_a_commit_made_without_hooks(hooked):
    stage(hooked, "notes.md", f"{GMAIL}\n")
    git(hooked, "commit", "-q", "--no-verify", "-m", "docs: notes")

    result = git(hooked, "push", "origin", "HEAD:refs/heads/feature", check=False)

    assert result.returncode != 0
    assert "notes.md:1:" in result.stdout + result.stderr
    assert git(hooked, "ls-remote", "origin", "refs/heads/feature").stdout == ""


def test_a_clean_commit_and_push_go_through(hooked):
    stage(hooked, "notes.md", "vendor@example.com\n")
    git(hooked, "commit", "-q", "-m", "docs: notes")

    git(hooked, "push", "-q", "origin", "HEAD:refs/heads/feature")

    assert git(hooked, "ls-remote", "origin", "refs/heads/feature").stdout != ""


def test_a_hook_in_the_git_directory_still_runs(hooked):
    marker = hooked / "ran"
    own = Path(git(hooked, "rev-parse", "--git-common-dir").stdout.strip())
    if not own.is_absolute():
        own = hooked / own
    hook = own / "hooks" / "pre-commit"
    hook.write_text(f"#!/bin/sh\ntouch {marker}\n")
    hook.chmod(0o755)
    stage(hooked, "notes.md", "fine\n")

    git(hooked, "commit", "-q", "-m", "docs: notes")

    assert marker.exists()


def test_the_pre_commit_hook_refuses_a_listed_name(hooked):
    added = own_check(hooked, "add-term", stdin=f"{LISTED}\n")
    assert added.returncode == 0, added.stdout + added.stderr
    git(hooked, "add", TERMS)
    git(hooked, "commit", "-q", "-m", "chore: list a name")
    stage(hooked, "notes.md", f"{LISTED}\n")

    result = git(hooked, "commit", "-m", "docs: notes", check=False)

    assert result.returncode != 0
    assert f"notes.md:1: {NAMED}" in result.stdout + result.stderr
    assert git(hooked, "log", "-1", "--format=%s").stdout.strip() == "chore: list a name"


@pytest.mark.parametrize("code", [0, 1])
def test_a_pre_push_hook_in_the_git_directory_gets_the_refs_and_decides(hooked, code):
    got = hooked / "got"
    own = Path(git(hooked, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip())
    hook = own / "hooks" / "pre-push"
    hook.write_text(f'#!/bin/sh\necho "$1 $2" >{got}\ncat >>{got}\nexit {code}\n')
    hook.chmod(0o755)
    stage(hooked, "notes.md", "fine\n")
    git(hooked, "commit", "-q", "-m", "docs: notes")
    head = git(hooked, "rev-parse", "HEAD").stdout.strip()

    result = git(hooked, "push", "-q", "origin", "HEAD:refs/heads/feature", check=False)

    arguments, refs = got.read_text().split("\n", 1)
    assert arguments.split()[0] == "origin"
    assert "refs/heads/feature" in refs and head in refs
    assert (result.returncode == 0) == (code == 0)
    pushed = git(hooked, "ls-remote", "origin", "refs/heads/feature").stdout
    assert (head in pushed) == (code == 0)


# --- The gate and CI ---------------------------------------------------------------------------


def ci_step(name):
    """The `run:` of the named step of the real-data job in test.yml, as Bash will run it."""
    workflow = (REPO / ".github" / "workflows" / "test.yml").read_text()
    match = re.search(rf"- name: {re.escape(name)}\n(?:\s+\w[\w-]*:.*\n)*?\s+run: (.+)\n", workflow)
    assert match, f"no step {name!r} with a one-line run in test.yml"
    return match.group(1)


@pytest.mark.parametrize("address, code", [(GMAIL, 1), ("vendor@example.com", 0)])
def test_the_ci_jobs_command_fails_a_pr_adding_a_real_shaped_address(repo, address, code):
    git(repo, "update-ref", "refs/remotes/origin/dev", "HEAD")
    head = commit(repo, "notes.md", f"{address}\n")
    git(repo, "checkout", "-q", "--detach", "origin/dev")  # CI checks out the PR's merge, not its head
    command = ci_step("No real data in the PR's commits")
    assert command.startswith("python scripts/real_data_check.py ")
    command = command.replace("python scripts/real_data_check.py", f"{sys.executable} {CHECKER}", 1)

    result = subprocess.run(
        [BASH, "-c", command],
        cwd=repo,
        env={"PATH": "/usr/bin:/bin", "BASE_REF": "dev", "HEAD_SHA": head},
        text=True,
        capture_output=True,
    )

    assert result.returncode == code, result.stdout + result.stderr


def test_the_ci_jobs_command_fails_a_pr_adding_a_listed_name(listed):
    git(listed, "update-ref", "refs/remotes/origin/dev", "HEAD")
    head = commit(listed, "notes.md", "fine\n", message=f"test: the {LISTED} fixture")
    git(listed, "checkout", "-q", "--detach", "origin/dev")
    command = ci_step("No real data in the PR's commits").replace(
        "python scripts/real_data_check.py", f"{sys.executable} scripts/real_data_check.py", 1
    )

    result = subprocess.run(
        [BASH, "-c", command],
        cwd=listed,
        env={"PATH": "/usr/bin:/bin", "BASE_REF": "dev", "HEAD_SHA": head},
        text=True,
        capture_output=True,
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert f"{head[:12]} message:1: {NAMED}" in result.stdout
