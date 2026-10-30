#!/usr/bin/env python3
"""Merge a knowledge-graph node as its frontmatter means: the git merge driver `.gitattributes` names for docs/.

    python3 scripts/merge_node.py install                     # register the driver in this repository's config
    python3 scripts/merge_node.py %O %A %B %L %P %S %X %Y     # as git runs it, from the work tree's top

A node's `describes` and `sources` are sets of strings, and every story appends its id to the end of
them, so two branches that each add one conflict on the frontmatter's last lines though both belong.
The driver merges those two lists as sets: the ancestor's items, less any either side removed, then the
items ours added and the items theirs added. `verified` becomes the later of the two days. Every other
line, the other keys and the body, is left to `git merge-file`, which marks a conflict as git's own
merge does, in the configured `merge.conflictStyle`. A list one side dropped, a list written inline, or
a file with no frontmatter merges as text. The result is written to %A; exits 0 on a clean merge, 1 on
a conflict. A checkout where `install` never ran merges these files as text, as git does without it.
Standard library only.
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
NAME = "kg-node"
DRIVER = "python3 scripts/merge_node.py %O %A %B %L %P %S %X %Y"
LIST_KEYS = ("describes", "sources")  # as scripts/knowledge_graph.py's LIST_KEYS
ITEM = re.compile(r"^\s+-\s+(.*?)\s*$")
VERIFIED = re.compile(r"^verified:\s*(\d{4}-\d{2}-\d{2})\s*$")


def frontmatter_end(lines):
    """The index of the closing `---`, or None when the file has no frontmatter."""
    if not lines or lines[0].rstrip("\r\n") != "---":
        return None
    return next((i for i in range(1, len(lines)) if lines[i].rstrip("\r\n") == "---"), None)


def key_lines(lines, key):
    end = frontmatter_end(lines)
    return [i for i in range(1, end) if re.match(rf"^{key}:", lines[i])]


def list_block(lines, key):
    """`(start, stop, items)` for a key written as a block list, None when the key is absent, else "other"."""
    found = key_lines(lines, key)
    if not found:
        return None
    if len(found) > 1 or lines[found[0]].rstrip("\r\n") != f"{key}:":
        return "other"
    start = stop = found[0] + 1
    items = []
    while stop < frontmatter_end(lines) and (item := ITEM.match(lines[stop].rstrip("\r\n"))):
        items.append((item.group(1), lines[stop]))
        stop += 1
    return start, stop, items


def merge_sets(ancestor, ours, theirs):
    kept = [item for item in ancestor if item in ours and item in theirs]
    added = [item for item in ours + theirs if item not in ancestor]
    return list(dict.fromkeys(kept + added))


def settle_list(versions, key):
    """Write the merged list into each version that has it, so the text merge sees no difference there."""
    blocks = [list_block(lines, key) for lines in versions]
    if "other" in blocks or blocks[1] is None or blocks[2] is None:
        return
    raw = {}
    for block in (blocks[1], blocks[2], blocks[0]):
        for value, line in block[2] if block else ():
            raw.setdefault(value, line)
    values = [[value for value, _ in block[2]] if block else [] for block in blocks]
    merged = merge_sets(*values) if blocks[0] else merge_sets([], values[1], values[2])
    for lines, block in zip(versions, blocks):
        if block:
            lines[block[0] : block[1]] = [raw[value] for value in merged]


def settle_verified(versions):
    found = [key_lines(lines, "verified") for lines in versions]
    days = [[VERIFIED.match(lines[i].rstrip("\r\n")) for i in at] for lines, at in zip(versions, found)]
    if any(len(at) > 1 or not all(days[n]) for n, at in enumerate(found)) or not found[1] or not found[2]:
        return
    later = max(days[1][0].group(1), days[2][0].group(1))
    for lines, at in zip(versions, found):
        if at:
            ending = lines[at[0]][len(lines[at[0]].rstrip("\r\n")) :]
            lines[at[0]] = f"verified: {later}{ending}"


def settle(texts):
    """The three versions with the lists and `verified` merged into each, or as they came when one is not a node."""
    versions = [text.splitlines(keepends=True) for text in texts]
    if any(frontmatter_end(lines) is None for lines in versions):
        return texts
    for key in LIST_KEYS:
        settle_list(versions, key)
    settle_verified(versions)
    return ["".join(lines) for lines in versions]


def conflict_style():
    style = subprocess.run(["git", "config", "--get", "merge.conflictStyle"], capture_output=True, text=True)
    return {"diff3": ["--diff3"], "zdiff3": ["--zdiff3"]}.get(style.stdout.strip(), [])


def merge(ancestor_path, ours_path, theirs_path, marker_size, labels):
    paths = (ancestor_path, ours_path, theirs_path)
    try:
        texts = settle([Path(path).read_text(encoding="utf-8") for path in paths])
    except UnicodeDecodeError:
        texts = None
    with tempfile.TemporaryDirectory() as scratch:
        if texts is not None:
            paths = [Path(scratch) / name for name in ("ancestor", "ours", "theirs")]
            for path, text in zip(paths, texts):
                path.write_bytes(text.encode("utf-8"))
        ancestor_label, ours_label, theirs_label = labels
        result = subprocess.run(
            ["git", "merge-file", "-p", f"--marker-size={marker_size}", *conflict_style()]
            + ["-L", ours_label, "-L", ancestor_label, "-L", theirs_label]
            + [str(paths[1]), str(paths[0]), str(paths[2])],
            capture_output=True,
        )
    if result.returncode < 0 or result.returncode > 127:  # git merge-file failed: no result to write
        sys.stderr.buffer.write(result.stderr)
        return 255
    Path(ours_path).write_bytes(result.stdout)
    return 0 if result.returncode == 0 else 1


def install():
    for key, value in (("name", "knowledge-graph node: describes and sources merge as sets"), ("driver", DRIVER)):
        subprocess.run(["git", "-C", str(REPO), "config", f"merge.{NAME}.{key}", value], check=True)
    return 0


def main(argv):
    if argv == ["install"]:
        return install()
    if len(argv) not in (5, 8):
        print(__doc__, file=sys.stderr)
        return 2
    ancestor, ours, theirs, marker_size, _path = argv[:5]
    labels = argv[5:8] if len(argv) == 8 else ("base", "ours", "theirs")
    return merge(ancestor, ours, theirs, marker_size, labels)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
