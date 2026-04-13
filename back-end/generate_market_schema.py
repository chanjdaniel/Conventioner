#!/usr/bin/env python3
"""
Generate a TypeScript declaration contract from market object JSON samples.

Usage:
    python generate_market_schema.py --input ../docs/market-schema-input.example.json --output ../docs/schema.d.ts
"""

from __future__ import annotations

import argparse
import importlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple


IDENTIFIER_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


@dataclass
class FieldInfo:
    type_node: Dict[str, Any]
    present_count: int


def infer_type_node(value: Any) -> Dict[str, Any]:
    if value is None:
        return {"kind": "null"}
    if isinstance(value, bool):
        return {"kind": "boolean"}
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return {"kind": "number"}
    if isinstance(value, str):
        return {"kind": "string"}
    if isinstance(value, list):
        if not value:
            return {"kind": "array", "element": None}
        element = infer_type_node(value[0])
        for item in value[1:]:
            element = merge_type_nodes(element, infer_type_node(item))
        return {"kind": "array", "element": element}
    if isinstance(value, dict):
        fields: Dict[str, FieldInfo] = {}
        for key, item in value.items():
            fields[key] = FieldInfo(type_node=infer_type_node(item), present_count=1)
        return {"kind": "object", "fields": fields, "sample_count": 1}
    return {"kind": "unknown"}


def merge_type_nodes(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    if a["kind"] == b["kind"]:
        if a["kind"] == "array":
            if a["element"] is None:
                return b
            if b["element"] is None:
                return a
            return {"kind": "array", "element": merge_type_nodes(a["element"], b["element"])}
        if a["kind"] == "object":
            return merge_object_nodes(a, b)
        return a

    if a["kind"] == "union":
        return add_to_union(a["types"], b)
    if b["kind"] == "union":
        return add_to_union(b["types"], a)
    return make_union([a, b])


def merge_object_nodes(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    merged_fields: Dict[str, FieldInfo] = {}
    sample_count = a["sample_count"] + b["sample_count"]
    all_keys = set(a["fields"].keys()) | set(b["fields"].keys())

    for key in all_keys:
        left = a["fields"].get(key)
        right = b["fields"].get(key)
        if left and right:
            merged_fields[key] = FieldInfo(
                type_node=merge_type_nodes(left.type_node, right.type_node),
                present_count=left.present_count + right.present_count,
            )
        elif left:
            merged_fields[key] = FieldInfo(
                type_node=left.type_node,
                present_count=left.present_count,
            )
        elif right:
            merged_fields[key] = FieldInfo(
                type_node=right.type_node,
                present_count=right.present_count,
            )

    return {"kind": "object", "fields": merged_fields, "sample_count": sample_count}


def normalize_union_members(types: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for type_node in types:
        if type_node["kind"] == "union":
            normalized.extend(normalize_union_members(type_node["types"]))
        else:
            normalized.append(type_node)

    deduped: dict[str, Dict[str, Any]] = {}
    for type_node in normalized:
        signature = json.dumps(type_node, default=field_info_to_dict, sort_keys=True)
        deduped[signature] = type_node

    return sorted(deduped.values(), key=type_sort_key)


def make_union(types: List[Dict[str, Any]]) -> Dict[str, Any]:
    members = normalize_union_members(types)
    if len(members) == 1:
        return members[0]
    return {"kind": "union", "types": members}


def add_to_union(existing: List[Dict[str, Any]], candidate: Dict[str, Any]) -> Dict[str, Any]:
    return make_union(existing + [candidate])


def type_sort_key(type_node: Dict[str, Any]) -> Tuple[str, str]:
    return (type_node["kind"], render_type(type_node, 0))


def field_info_to_dict(value: Any) -> Any:
    if isinstance(value, FieldInfo):
        return {"type_node": value.type_node, "present_count": value.present_count}
    raise TypeError(f"Unsupported value: {type(value)!r}")


def format_field_name(name: str) -> str:
    if IDENTIFIER_RE.match(name):
        return name
    return json.dumps(name)


def should_render_as_record(fields: Dict[str, FieldInfo], path: Tuple[str, ...]) -> bool:
    if not fields:
        return False
    return any(("-" in key) or ("@" in key) for key in fields.keys())


def render_type(type_node: Dict[str, Any], indent_level: int, path: Tuple[str, ...] = ()) -> str:
    kind = type_node["kind"]
    if kind in {"string", "number", "boolean", "null", "unknown"}:
        return kind
    if kind == "array":
        if type_node["element"] is None:
            return "unknown[]"
        element = render_type(type_node["element"], indent_level, path + ("[]",))
        if "|" in element and not element.startswith("("):
            element = f"({element})"
        return f"{element}[]"
    if kind == "union":
        members = [render_type(t, indent_level, path) for t in type_node["types"]]
        return " | ".join(members)
    if kind == "object":
        fields: Dict[str, FieldInfo] = type_node["fields"]
        if should_render_as_record(fields, path):
            merged_value_type: Dict[str, Any] = {"kind": "unknown"}
            first = True
            for key in sorted(fields.keys()):
                if first:
                    merged_value_type = fields[key].type_node
                    first = False
                else:
                    merged_value_type = merge_type_nodes(merged_value_type, fields[key].type_node)
            value_type = render_type(merged_value_type, indent_level, path + ("{value}",))
            return f"Record<string, {value_type}>"

        indent = "  " * indent_level
        inner = "  " * (indent_level + 1)
        lines: List[str] = ["{"]
        sample_count = type_node["sample_count"]
        for key in sorted(fields.keys()):
            info = fields[key]
            optional = "?" if info.present_count < sample_count else ""
            value = render_type(info.type_node, indent_level + 1, path + (key,))
            lines.append(f"{inner}{format_field_name(key)}{optional}: {value};")
        lines.append(f"{indent}}}")
        return "\n".join(lines)
    return "unknown"


def generate_declaration(root_node: Dict[str, Any], root_name: str, command_hint: str) -> str:
    header = [
        "/**",
        " * AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.",
        f" * Regenerate with: {command_hint}",
        " */",
        "",
    ]
    if root_node["kind"] == "object":
        shape = render_type(root_node, 0)
        body = [f"export interface {root_name} {shape}"]
    else:
        body = [f"export type {root_name} = {render_type(root_node, 0)};"]
    return "\n".join(header + body) + "\n"


def load_market_samples(input_path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(input_path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        if not raw:
            raise ValueError("Input array must contain at least one market object.")
        invalid = [idx for idx, item in enumerate(raw) if not isinstance(item, dict)]
        if invalid:
            raise ValueError(f"Input array must only contain objects. Invalid indices: {invalid}")
        return raw
    raise ValueError("Input must be a JSON object or an array of JSON objects.")


def build_root_type(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    root = infer_type_node(samples[0])
    for sample in samples[1:]:
        root = merge_type_nodes(root, infer_type_node(sample))
    return root


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a TypeScript declaration from market JSON samples.")
    parser.add_argument("--input", help="Path to JSON file (object or array of objects).")
    parser.add_argument("--output", default="../docs/schema.d.ts", help="Output .d.ts path.")
    parser.add_argument("--root-name", default="MarketSchema", help="Exported root type/interface name.")
    parser.add_argument(
        "--model",
        default="datatypes:MarketSchemaContract",
        help="Python path to pydantic model in module:Class format.",
    )
    return parser.parse_args()


def load_model_class(model_path: str) -> Any:
    module_name, _, class_name = model_path.partition(":")
    if not module_name or not class_name:
        raise ValueError("Model must be provided as module:Class.")
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


def schema_ref_name(ref: str) -> str:
    return ref.rsplit("/", 1)[-1]


def render_from_json_schema(
    schema: Dict[str, Any],
    defs: Dict[str, Dict[str, Any]],
    indent_level: int,
) -> str:
    if "$ref" in schema:
        return render_from_json_schema(defs[schema_ref_name(schema["$ref"])], defs, indent_level)

    if "enum" in schema:
        return "string"

    schema_type = schema.get("type")
    if schema_type in {"string", "boolean", "null"}:
        return schema_type
    if schema_type in {"number", "integer"}:
        return "number"
    if schema_type == "array":
        items = schema.get("items", {})
        element = render_from_json_schema(items, defs, indent_level)
        if "|" in element and not element.startswith("("):
            element = f"({element})"
        return f"{element}[]"
    if schema_type == "object":
        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            value_type = render_from_json_schema(additional, defs, indent_level)
            return f"Record<string, {value_type}>"
        properties = schema.get("properties", {})
        required = set(schema.get("required", []))
        indent = "  " * indent_level
        inner = "  " * (indent_level + 1)
        lines: List[str] = ["{"]
        for key in sorted(properties.keys()):
            value = render_from_json_schema(properties[key], defs, indent_level + 1)
            optional = "" if key in required else "?"
            if optional and "null | " in value:
                value = " | ".join(part for part in value.split(" | ") if part != "null")
            lines.append(f"{inner}{format_field_name(key)}{optional}: {value};")
        lines.append(f"{indent}}}")
        return "\n".join(lines)

    union_nodes = schema.get("anyOf") or schema.get("oneOf")
    if union_nodes:
        rendered = [render_from_json_schema(node, defs, indent_level) for node in union_nodes]
        if "null" in rendered:
            rendered = ["null"] + [node for node in rendered if node != "null"]
        return " | ".join(rendered)

    return "unknown"


def build_root_type_from_model(model_path: str) -> Dict[str, Any]:
    model_cls = load_model_class(model_path)
    schema = model_cls.model_json_schema(by_alias=True)
    defs = schema.get("$defs", {})
    return {"kind": "schema", "schema": schema, "defs": defs}


def generate_declaration_from_model(root_type: Dict[str, Any], root_name: str, command_hint: str) -> str:
    schema = root_type["schema"]
    defs = root_type["defs"]
    header = [
        "/**",
        " * AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.",
        f" * Regenerate with: {command_hint}",
        " */",
        "",
    ]
    body_shape = render_from_json_schema(schema, defs, 0)
    return "\n".join(header + [f"export interface {root_name} {body_shape}"]) + "\n"


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).resolve()
    if args.input:
        input_path = Path(args.input).resolve()
        samples = load_market_samples(input_path)
        root_node = build_root_type(samples)
        declaration = generate_declaration(
            root_node=root_node,
            root_name=args.root_name,
            command_hint=f"python back-end/generate_market_schema.py --input {args.input} --output {args.output}",
        )
    else:
        root_type = build_root_type_from_model(args.model)
        declaration = generate_declaration_from_model(
            root_type=root_type,
            root_name=args.root_name,
            command_hint="python back-end/generate_market_schema.py --input ../docs/market-schema-input.example.json --output ../docs/schema.d.ts",
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(declaration, encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
