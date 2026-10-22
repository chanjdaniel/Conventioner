#!/usr/bin/env python3
"""Check Conventioner's knowledge graph: the Markdown nodes under docs/ and the links between them.

    python scripts/knowledge_graph.py check
    python scripts/knowledge_graph.py drift --base REF [--head REF]
    python scripts/knowledge_graph.py stale [--days N]
    python scripts/knowledge_graph.py ids

`docs/README.md` states the graph's contract; this script is its enforcement. One parser reads the
tracked files, their frontmatter, links, headings and the symbols nodes describe, and the four
commands read what it built. Standard library only, Python 3.11+.
"""

import argparse
import ast
import datetime
import posixpath
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from urllib.parse import unquote

# ── The contract ─────────────────────────────────────────────────────────────

KEYS = ("layer", "kind", "describes", "verified", "sources", "status")
LIST_KEYS = {"describes", "sources"}

LAYER_OF = {
    "concept": "business",
    "flow": "business",
    "rule": "business",
    "intent": "business",
    "module": "implementation",
    "data": "implementation",
    "convention": "implementation",
    "adr": "implementation",
    "runbook": "implementation",
    "testing": "implementation",
    "record": "implementation",
}

REQUIRED, OPTIONAL, FORBIDDEN = "required", "optional", "forbidden"


def _rules(describes, verified, status):
    return {"describes": describes, "verified": verified, "status": status}


KEY_RULES = {
    "concept": _rules(FORBIDDEN, REQUIRED, FORBIDDEN),
    "intent": _rules(FORBIDDEN, REQUIRED, FORBIDDEN),
    "flow": _rules(OPTIONAL, REQUIRED, FORBIDDEN),
    "rule": _rules(OPTIONAL, REQUIRED, FORBIDDEN),
    "module": _rules(REQUIRED, REQUIRED, FORBIDDEN),
    "data": _rules(REQUIRED, REQUIRED, FORBIDDEN),
    "convention": _rules(REQUIRED, REQUIRED, FORBIDDEN),
    "testing": _rules(REQUIRED, REQUIRED, FORBIDDEN),
    "runbook": _rules(OPTIONAL, REQUIRED, FORBIDDEN),
    "adr": _rules(OPTIONAL, REQUIRED, REQUIRED),
    "record": _rules(FORBIDDEN, FORBIDDEN, FORBIDDEN),
}

GRAPH_FOLDERS = {
    "docs/business/concepts": "concept",
    "docs/business/flows": "flow",
    "docs/business/rules": "rule",
    "docs/business/intents": "intent",
    "docs/implementation/modules": "module",
    "docs/implementation/data": "data",
    "docs/implementation/conventions": "convention",
    "docs/implementation/testing": "testing",
    "docs/records": "record",
    "docs/adr": "adr",
}
LAYER_FOLDERS = ("docs/business", "docs/implementation")
ENTRY_HUB = "docs/README.md"
HUBS = {ENTRY_HUB, "CONTEXT.md", "docs/USER_FLOWS.md"} | {f"{d}/README.md" for d in GRAPH_FOLDERS}
STARTS = ("README.md", "AGENTS.md")
SKIPPED_FILES = {"CHANGELOG.md"}
SCRATCH = ".scratch/"

KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
ADR_NAME = re.compile(r"^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
ADR_STATUS = re.compile(r"^(?:proposed|accepted|superseded by \d{4})$")
SOURCE = re.compile(
    r"^(?:E\d{2}(?:/F\d{2}(?:/S\d{2})?)?"
    r"|wayfinding/[a-z0-9]+(?:-[a-z0-9]+)*/(?:\d{2}|map)"
    r"|brain-dump/\d{4}-\d{2}-\d{2}(?:#\d+)?"
    r"|qc/2026-09-21"
    r"|bug/\d+"
    r"|known-gap/\d+"
    r"|T\d+"
    r"|decision/\d{4}-\d{2}-\d{2})$"
)
WORK_ITEM = re.compile(r"\bE\d{2}(?:/F\d{2}(?:/S\d{2})?)?\b")

# ── git ──────────────────────────────────────────────────────────────────────


def git(*args, cwd=None, check=True):
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise SystemExit(f"knowledge_graph: git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def tracked_files(root):
    """Every tracked path, and the set of those that are symlinks (mode 120000)."""
    paths, links = set(), set()
    for line in git("ls-files", "-s", "-z", cwd=root).split("\0"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        paths.add(path)
        if meta.startswith("120000"):
            links.add(path)
    return paths, links


# ── Markdown ─────────────────────────────────────────────────────────────────

FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
ATX = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$")
CODE_SPAN = re.compile(r"(`+)(?:(?!\n\s*\n).)+?\1", re.S)
TEXT = r"\[((?:[^\[\]\\]|\\.|\[(?:[^\[\]\\]|\\.)*\])*)\]"
DESTINATION = r"(<[^<>\n]*>|(?:[^\s()<]|\((?:[^\s()])*\))+)"
TITLE = r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?"
INLINE_LINK = re.compile(r"(!?)" + TEXT + r"\(\s*" + DESTINATION + TITLE + r"\s*\)")
REFERENCE = re.compile(r"^ {0,3}\[[^\]]+\]:[ \t]*(<[^<>\n]*>|\S+)", re.M)
ANCHOR = re.compile(r"<a\s[^>]*?\b(?:id|name)\s*=\s*[\"']([^\"']+)[\"']", re.I)
SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


@dataclass
class Link:
    line: int
    target: str  # as written
    path: str | None  # resolved repo path, None for a same-file fragment
    fragment: str | None


@dataclass
class Doc:
    path: str
    text: str
    meta: dict = field(default_factory=dict)  # key -> (value, line); list values are [(item, line)]
    meta_errors: list = field(default_factory=list)
    has_frontmatter: bool = False
    body_start: int = 1
    links: list = field(default_factory=list)
    anchors: set = field(default_factory=set)

    @property
    def is_node(self):
        return "layer" in self.meta or "kind" in self.meta

    @property
    def layer(self):
        return self.meta.get("layer", (None,))[0]

    @property
    def kind(self):
        return self.meta.get("kind", (None,))[0]


def _strip_comment(value):
    match = re.search(r"\s#", value)
    return (value[: match.start()] if match else value).strip()


def _unquote(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_frontmatter(doc):
    lines = doc.text.split("\n")
    if not lines or lines[0].rstrip() != "---":
        return
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].rstrip() == "---")
    except StopIteration:
        doc.meta_errors.append((1, "frontmatter has no closing ---"))
        return
    doc.has_frontmatter = True
    doc.body_start = end + 2
    current = None
    for index in range(1, end):
        number, raw = index + 1, lines[index]
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s+-\s+(.*)$", raw)
        if item:
            if current is None or not isinstance(doc.meta[current][0], list):
                doc.meta_errors.append((number, "a list item belongs under a key"))
                continue
            doc.meta[current][0].append((_unquote(_strip_comment(item.group(1))), number))
            continue
        pair = re.match(r"^([A-Za-z_][\w-]*):(?:\s+(.*))?$", raw)
        if not pair:
            doc.meta_errors.append((number, f"frontmatter line not understood: {raw.strip()}"))
            current = None
            continue
        key, value = pair.group(1), _strip_comment(pair.group(2) or "")
        if key in doc.meta:
            doc.meta_errors.append((number, f"duplicate key: {key}"))
        if value == "":
            doc.meta[key] = ([], number)
        elif value.startswith("[") and value.endswith("]"):
            items = [_unquote(v.strip()) for v in value[1:-1].split(",") if v.strip()]
            doc.meta[key] = ([(v, number) for v in items], number)
        else:
            doc.meta[key] = (_unquote(value), number)
        current = key


def _masked(text, start_line):
    """The text with fenced code blocks, inline code and frontmatter blanked, keeping offsets."""
    out = []
    fence = None
    for number, line in enumerate(text.split("\n"), start=1):
        if number < start_line:
            out.append(" " * len(line))
            continue
        match = FENCE.match(line)
        if fence:
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
                fence = None
            out.append(" " * len(line))
        elif match:
            fence = match.group(1)
            out.append(" " * len(line))
        else:
            out.append(line)
    masked = "\n".join(out)
    return CODE_SPAN.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), masked)


def _line_at(text, offset):
    return text.count("\n", 0, offset) + 1


def slug(heading):
    """GitHub's anchor for a heading: rendered text, lowercased, punctuation dropped, spaces to -."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", heading)  # links and images -> their text
    text = re.sub(r"<[^>]+>", "", text)  # inline HTML
    text = text.replace("`", "")
    text = text.replace("*", "")
    text = re.sub(r"(?<![^\W_])_+|_+(?![^\W_])", "", text)  # emphasis underscores, not snake_case
    text = text.strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def parse_markdown(doc):
    masked = _masked(doc.text, doc.body_start)
    seen = Counter()
    for raw, line in zip(doc.text.split("\n"), masked.split("\n")):
        heading = ATX.match(raw) if ATX.match(line) else None  # masked finds it, raw keeps its code
        if heading:
            base = slug(heading.group(2) or "")
            doc.anchors.add(base if not seen[base] else f"{base}-{seen[base]}")
            seen[base] += 1
    doc.anchors.update(m.group(1) for m in ANCHOR.finditer(masked))

    def add(offset, target):
        target = target.strip()
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1]
        doc.links.append(_resolve(doc.path, _line_at(masked, offset), target))

    def scan(text, base):
        for match in INLINE_LINK.finditer(text):
            add(base + match.start(3), match.group(3))
            scan(match.group(2), base + match.start(2))  # an image inside a link's text

    scan(masked, 0)
    for match in REFERENCE.finditer(masked):
        add(match.start(1), match.group(1))


def _resolve(source, line, target):
    if SCHEME.match(target) or target.startswith("//"):
        return Link(line, target, None, None)  # external: not checked
    path, _, fragment = target.partition("#")
    path = unquote(path.split("?", 1)[0])
    fragment = unquote(fragment) if "#" in target else None
    if not path:
        return Link(line, target, None, fragment)
    if path.startswith("/"):
        joined = posixpath.normpath(path.lstrip("/"))
    else:
        joined = posixpath.normpath(posixpath.join(posixpath.dirname(source), path))
    return Link(line, target, joined, fragment)


def is_external(link):
    return link.path is None and link.fragment is None


# ── Symbols ──────────────────────────────────────────────────────────────────

TS_DECLARATION = re.compile(
    r"^(?:(?:export|default|declare|async|abstract)\s+)*"
    r"(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)"
)
TS_SUFFIXES = (".ts", ".tsx", ".js", ".mjs", ".vue")


def symbol_spans(path, text):
    """{name: (first line, last line)} for the symbols a `describes` entry may name, or None."""
    if path.endswith(".py"):
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return {}
        spans = {}

        def span(item):
            first = min([item.lineno] + [d.lineno for d in getattr(item, "decorator_list", [])])
            return first, item.end_lineno

        def names(item):
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                return [item.name]
            targets = item.targets if isinstance(item, ast.Assign) else [getattr(item, "target", None)]
            if isinstance(item, (ast.Assign, ast.AnnAssign)):
                return [t.id for t in targets if isinstance(t, ast.Name)]
            return []

        for item in tree.body:
            for name in names(item):
                spans[name] = span(item)
            if isinstance(item, ast.ClassDef):
                for member in item.body:
                    for name in names(member):
                        spans[f"{item.name}.{name}"] = span(member)
        return spans
    if path.endswith(TS_SUFFIXES):
        lines = text.split("\n")
        starts = [(i + 1, m.group(1)) for i, line in enumerate(lines) if (m := TS_DECLARATION.match(line))]
        spans = {}
        for index, (start, name) in enumerate(starts):
            end = starts[index + 1][0] - 1 if index + 1 < len(starts) else len(lines)
            spans.setdefault(name, (start, end))
        return spans
    return None


# ── The repository, parsed once ──────────────────────────────────────────────


class Repo:
    def __init__(self):
        self.root = git("rev-parse", "--show-toplevel").strip()
        self.paths, self.links = tracked_files(self.root)
        self.dirs = set()
        for path in self.paths:
            parts = path.split("/")
            for i in range(1, len(parts)):
                self.dirs.add("/".join(parts[:i]))
        self.docs = {}
        for path in sorted(self.paths):
            if not self.is_checked(path):
                continue
            text = self.read(path)
            if text is None:
                continue
            doc = Doc(path, text)
            parse_frontmatter(doc)
            parse_markdown(doc)
            self.docs[path] = doc

    def git(self, *args, check=True):
        return git(*args, cwd=self.root, check=check)

    def is_checked(self, path):
        return (
            path.endswith(".md")
            and not path.startswith(SCRATCH)
            and path not in self.links
            and path not in SKIPPED_FILES
        )

    def read(self, path):
        try:
            with open(f"{self.root}/{path}", encoding="utf-8") as handle:
                return handle.read()
        except (OSError, UnicodeDecodeError):
            return None

    @property
    def nodes(self):
        return {p: d for p, d in self.docs.items() if d.is_node}

    def hubs(self):
        return {p: d for p, d in self.docs.items() if p in HUBS}

    def exists(self, path):
        return path in self.paths or path in self.dirs

    def doc_for(self, path):
        """The checked Markdown file a link to `path` lands on (a directory lands on its README)."""
        if path in self.docs:
            return self.docs[path]
        return self.docs.get(f"{path}/README.md") if path in self.dirs else None


# ── check ────────────────────────────────────────────────────────────────────


def check(repo):
    problems = []

    def report(path, line, message):
        problems.append((path, line, message))

    for path, doc in repo.docs.items():
        check_links(repo, doc, report)
        if path in HUBS and doc.has_frontmatter:
            report(path, 1, "a hub must not carry frontmatter")
        elif doc.is_node:
            check_schema(repo, doc, report)
        for line, message in doc.meta_errors:
            report(path, line, message)
    check_folders(repo, report)
    check_reachability(repo, report)
    check_back_links(repo, report)

    for path, line, message in sorted(problems, key=lambda p: (p[0], p[1], p[2])):
        print(f"{path}:{line}: {message}")
    nodes, hubs = len(repo.nodes), len(repo.hubs())
    links = sum(len(d.links) for d in repo.docs.values())
    print(
        f"knowledge graph: {len(repo.docs)} files, {nodes} nodes, {hubs} hubs, {links} links; "
        f"{len(problems)} error{'s' if len(problems) != 1 else ''}"
    )
    return 1 if problems else 0


def check_links(repo, doc, report):
    in_graph = doc.is_node or doc.path in HUBS
    for link in doc.links:
        if is_external(link):
            continue
        if link.path is None:
            if link.fragment and not _has_anchor(doc, link.fragment):
                report(doc.path, link.line, f"broken fragment: {link.target}")
            continue
        if in_graph and (link.path + "/").startswith(SCRATCH):
            report(doc.path, link.line, f"a graph file never links into .scratch/: {link.target}")
            continue
        if link.path.startswith("..") or not repo.exists(link.path):
            report(doc.path, link.line, f"broken link: {link.target}")
            continue
        if link.fragment and link.path.endswith(".md"):
            target = repo.docs.get(link.path)
            if target is None:
                target_text = repo.read(link.path)
                if target_text is None:
                    continue
                target = Doc(link.path, target_text)
                parse_frontmatter(target)
                parse_markdown(target)
            if not _has_anchor(target, link.fragment):
                report(doc.path, link.line, f"broken fragment: {link.target}")


def _has_anchor(doc, fragment):
    return fragment in doc.anchors or fragment.lower() in doc.anchors


def check_schema(repo, doc, report):
    meta, path = doc.meta, doc.path
    order = [k for k in meta if k in KEYS]
    for key in meta:
        if key not in KEYS:
            report(path, meta[key][1], f"unknown frontmatter key: {key}")
    if order != sorted(order, key=KEYS.index):
        report(path, 1, f"frontmatter keys out of order; the order is {', '.join(KEYS)}")
    for key in ("layer", "kind"):
        if key not in meta:
            report(path, 1, f"missing required key: {key}")
    for key, (value, line) in meta.items():
        if key in KEYS and (key in LIST_KEYS) != isinstance(value, list):
            report(path, line, f"{key} must be {'a list' if key in LIST_KEYS else 'one value'}")
    kind, layer = doc.kind, doc.layer
    if "kind" in meta and kind not in LAYER_OF:
        report(path, meta["kind"][1], f"unknown kind: {kind}")
        return
    if "layer" in meta and layer not in ("business", "implementation"):
        report(path, meta["layer"][1], f"unknown layer: {layer}")
    elif kind and layer and LAYER_OF[kind] != layer:
        report(path, meta["layer"][1], f"a {kind} is in the {LAYER_OF[kind]} layer, not {layer}")
    if not kind:
        return
    for key, rule in KEY_RULES[kind].items():
        if rule == REQUIRED and key not in meta:
            report(path, 1, f"a {kind} requires {key}")
        if rule == FORBIDDEN and key in meta:
            report(path, meta[key][1], f"a {kind} has no {key}")
    if "verified" in meta and isinstance(meta["verified"][0], str):
        check_verified(meta["verified"], path, report)
    if "status" in meta and isinstance(meta["status"][0], str) and not ADR_STATUS.match(meta["status"][0]):
        report(path, meta["status"][1], f"status is proposed, accepted or superseded by NNNN: {meta['status'][0]}")
    if isinstance(meta.get("sources", (None,))[0], list):
        for value, line in meta["sources"][0]:
            if not SOURCE.match(value):
                report(path, line, f"not a source string: {value}")
    if isinstance(meta.get("describes", (None,))[0], list):
        entries = meta["describes"][0]
        if KEY_RULES[kind]["describes"] == REQUIRED and not entries:
            report(path, meta["describes"][1], f"a {kind} describes at least one path")
        linked = {link.path for link in doc.links if link.path}
        for value, line in entries:
            check_describes(repo, path, value, line, linked, report)


def check_verified(entry, path, report):
    value, line = entry
    try:
        day = datetime.date.fromisoformat(value) if re.match(r"^\d{4}-\d{2}-\d{2}$", value) else None
    except ValueError:
        day = None
    if day is None:
        report(path, line, f"verified is a real date, YYYY-MM-DD: {value}")
    elif day > latest_today():
        report(path, line, f"verified is in the future: {value}")


def latest_today():
    """Today in the furthest-east time zone: an author's local day is never ahead of it, wherever CI runs."""
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=14))).date()


def check_describes(repo, path, value, line, linked, report):
    file, _, symbol = value.partition("#")
    if file.endswith("/"):
        if file.rstrip("/") not in repo.dirs:
            report(path, line, f"describes a directory that is not tracked: {value}")
            return
    elif file in repo.dirs:
        report(path, line, f"a described directory ends in /: {value}")
        return
    elif file not in repo.paths:
        report(path, line, f"describes a file that is not tracked: {value}")
        return
    if symbol:
        spans = symbol_spans(file, repo.read(file) or "")
        if spans is None:
            report(path, line, f"symbols are named only in Python, TypeScript and Vue: {value}")
        elif symbol not in spans:
            report(path, line, f"describes a symbol not found: {value}")
    if file.rstrip("/") not in {p.rstrip("/") for p in linked}:
        report(path, line, f"the body never links described file: {file}")


def check_folders(repo, report):
    if ENTRY_HUB not in repo.docs:
        return  # the folders join the graph with its entry, as the hubs do
    for folder, kind in GRAPH_FOLDERS.items():
        if folder in repo.dirs and f"{folder}/README.md" not in repo.paths:
            report(f"{folder}/README.md", 1, "a graph folder has a README.md hub")
    for path, doc in repo.docs.items():
        name = posixpath.basename(path)
        folder = next((f for f in GRAPH_FOLDERS if path.startswith(f + "/")), None)
        if folder:
            if name == "README.md":
                continue
            kind = GRAPH_FOLDERS[folder]
            if doc.kind != kind:
                report(path, 1, f"{folder}/ holds only nodes of kind {kind}")
            if folder == "docs/adr" and not ADR_NAME.match(name):
                report(path, 1, "an ADR is named NNNN-kebab-title.md")
            elif folder.startswith(LAYER_FOLDERS) and not KEBAB.match(name):
                report(path, 1, "a node's file name is kebab-case")
        elif path.startswith(tuple(f + "/" for f in LAYER_FOLDERS)):
            report(path, 1, "a file under docs/business/ or docs/implementation/ belongs in a kind folder")


def check_reachability(repo, report):
    reached, queue = set(), [s for s in STARTS if s in repo.docs]
    while queue:
        path = queue.pop()
        if path in reached:
            continue
        reached.add(path)
        for link in repo.docs[path].links:
            target = repo.doc_for(link.path) if link.path else None
            if target and target.path not in reached:
                queue.append(target.path)
    # The hubs join the graph with its entry: until docs/README.md exists there is no graph to reach.
    hubs_count = ENTRY_HUB in repo.docs
    for path, doc in repo.docs.items():
        if path in reached:
            continue
        if doc.is_node or (hubs_count and path in HUBS):
            report(path, 1, "not reachable from README.md or AGENTS.md")


def check_back_links(repo, report):
    for path, doc in repo.nodes.items():
        for link in doc.links:
            target = repo.doc_for(link.path) if link.path else None
            if not target or not target.is_node or target.path == path:
                continue
            if target.layer == doc.layer or not target.layer or not doc.layer:
                continue
            if not any(repo.doc_for(back.path) is doc for back in target.links if back.path):
                report(path, link.line, f"{target.path} does not link back to this {doc.layer} node")


# ── drift ────────────────────────────────────────────────────────────────────

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.M)


def changed_lines(repo, base, head, path):
    """The new-side line ranges a diff touches; a pure deletion spans the two lines it fell between."""
    diff = repo.git("diff", "-U0", "--no-renames", f"{base}...{head}", "--", path)
    ranges = []
    for start, count in HUNK.findall(diff):
        start, count = int(start), 1 if count == "" else int(count)
        ranges.append((start, start + count - 1) if count else (start, start + 1))
    return ranges


def verified_day(doc):
    value = doc.meta.get("verified", (None,))[0]
    try:
        return datetime.date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def drift(repo, base, head):
    changed = set(repo.git("diff", "--name-only", "--no-renames", f"{base}...{head}").split("\n")) - {""}
    spans_at_head, hunks, last_changed = {}, {}, {}

    def touched(file):
        if file not in hunks:
            hunks[file] = changed_lines(repo, base, head, file)
        return hunks[file]

    def spans(file):
        if file not in spans_at_head:
            text = repo.git("show", f"{head}:{file}", check=False)
            spans_at_head[file] = symbol_spans(file, text) or {}
        return spans_at_head[file]

    def newest_day(file):
        """The day the range last touched the file: its own commits, not a merge carrying them, each
        dated by its committer's own calendar day, as `verified` is. The committer date, because a
        rebase, cherry-pick or amend moves it to the day the change reached this code, while the
        author date stays on the day it was first written."""
        if file not in last_changed:
            days = repo.git("log", "--format=%cs", "--no-merges", f"{base}..{head}", "--", file).split()
            last_changed[file] = max(map(datetime.date.fromisoformat, days), default=None)
        return last_changed[file]

    warnings = []
    for path, doc in sorted(repo.nodes.items()):
        if path in changed or not isinstance(doc.meta.get("describes", (None,))[0], list):
            continue
        verified, day = doc.meta.get("verified"), verified_day(doc)
        for value, _ in doc.meta["describes"][0]:
            file, _, symbol = value.partition("#")
            for hit in sorted(changed):
                if file.endswith("/"):
                    matches = hit.startswith(file)
                elif hit != file:
                    matches = False
                elif not symbol or symbol not in spans(file):
                    matches = True
                else:
                    first, last = spans(file)[symbol]
                    matches = any(a <= last and b >= first for a, b in touched(file))
                if matches and (day is None or newest_day(hit) is None or day < newest_day(hit)):
                    warnings.append((path, verified, value, hit))
    for path, verified, value, hit in warnings:
        line = verified[1] if verified else 1
        bump = f'bump "verified: {verified[0]}"' if verified else "touch the node"
        print(f"{path}:{line}: {hit} changed, and this node describes {value}; re-read it and {bump}")
    print(f"knowledge graph drift against {base}: {len(warnings)} warning{'s' if len(warnings) != 1 else ''}")
    return 1 if warnings else 0


# ── stale ────────────────────────────────────────────────────────────────────


def stale(repo, days):
    cutoff = datetime.date.today() - datetime.timedelta(days=days)
    found = []
    for path, doc in sorted(repo.nodes.items()):
        verified = doc.meta.get("verified", (None,))[0]
        describes = doc.meta.get("describes", (None,))[0]
        if not isinstance(verified, str) or not isinstance(describes, list) or not describes:
            continue
        try:
            day = datetime.date.fromisoformat(verified)
        except ValueError:
            continue
        if day >= cutoff:
            continue
        files = sorted({value.partition("#")[0] for value, _ in describes})
        since = (day + datetime.timedelta(days=1)).isoformat()
        commits = repo.git("log", f"--since={since}T00:00:00", "--format=%H", "--", *files).split()
        if commits:
            found.append((path, verified, len(commits)))
    for path, verified, count in found:
        print(f"{path}: verified {verified}, {count} commit{'s' if count != 1 else ''} to its described files since")
    print(f"knowledge graph: {len(found)} stale node{'s' if len(found) != 1 else ''} (verified over {days} days ago)")
    return 0


# ── ids ──────────────────────────────────────────────────────────────────────


def ids(repo):
    covered = set()
    for doc in repo.nodes.values():
        sources = doc.meta.get("sources", (None,))[0]
        if isinstance(sources, list):
            covered.update(value for value, _ in sources)
    cited = Counter()
    for path in repo.paths:
        if path.startswith(SCRATCH) or path in repo.links or path in SKIPPED_FILES:
            continue
        if path in repo.docs and repo.docs[path].is_node:
            continue
        text = repo.read(path)
        if text is None or "\0" in text:
            continue
        cited.update(WORK_ITEM.findall(text))

    def is_covered(item):
        parts = item.split("/")
        return any("/".join(parts[:i]) in covered for i in range(1, len(parts) + 1))

    uncovered = {item: n for item, n in cited.items() if not is_covered(item)}
    for item in sorted(uncovered, key=lambda i: (-uncovered[i], i)):
        print(f"{uncovered[item]:5d} {item}")
    print(
        f"knowledge graph: {len(uncovered)} work-item ids cited outside the graph that no node's sources cover "
        f"({sum(uncovered.values())} citations)"
    )
    return 0


# ── CLI ──────────────────────────────────────────────────────────────────────


def main(argv=None):
    parser = argparse.ArgumentParser(prog="knowledge_graph.py", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="schema, links, fragments, reachability, back-links, folders")
    drift_parser = commands.add_parser("drift", help="nodes whose described code changed without them")
    drift_parser.add_argument("--base", required=True)
    drift_parser.add_argument("--head", default="HEAD")
    stale_parser = commands.add_parser("stale", help="nodes verified long ago whose code has moved since")
    stale_parser.add_argument("--days", type=int, default=60)
    commands.add_parser("ids", help="work-item ids in the code that no node's sources cover")
    args = parser.parse_args(argv)

    repo = Repo()
    if args.command == "check":
        return check(repo)
    if args.command == "drift":
        return drift(repo, args.base, args.head)
    if args.command == "stale":
        return stale(repo, args.days)
    return ids(repo)


if __name__ == "__main__":
    sys.exit(main())
