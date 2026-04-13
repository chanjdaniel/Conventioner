import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate_market_schema as schema_gen


ROOT_DIR = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT_DIR / "docs" / "schema.d.ts"


def test_model_derived_declaration_matches_checked_in_schema_contract():
    root_type = schema_gen.build_root_type_from_model("datatypes:MarketSchemaContract")
    declaration = schema_gen.generate_declaration_from_model(
        root_type=root_type,
        root_name="MarketSchema",
        command_hint="python back-end/generate_market_schema.py --input ../docs/market-schema-input.example.json --output ../docs/schema.d.ts",
    )
    expected = SCHEMA_PATH.read_text(encoding="utf-8")
    assert declaration == expected


def test_record_fields_are_derived_from_dict_types_without_forcing():
    root_type = schema_gen.build_root_type_from_model("datatypes:MarketSchemaContract")
    declaration = schema_gen.generate_declaration_from_model(
        root_type=root_type,
        root_name="MarketSchema",
        command_hint="python back-end/generate_market_schema.py --input ../docs/market-schema-input.example.json --output ../docs/schema.d.ts",
    )

    assert "roles: Record<string, string>;" in declaration
    assert "assignmentsPerDate: Record<string, number>;" in declaration
    assert "assignmentsPerSection: Record<string, number>;" in declaration
    assert "assignmentsPerTier: Record<string, number>;" in declaration
    assert "unassignedTables: Record<string, {" in declaration
    assert not hasattr(schema_gen, "FORCED_RECORD_FIELDS")


def test_json_schema_mapping_handles_nullable_arrays_and_enums():
    fake_defs = {
        "Thing": {
            "type": "object",
            "properties": {
                "k": {"type": "string"},
            },
            "required": ["k"],
        }
    }
    schema = {
        "type": "object",
        "properties": {
            "dictField": {"type": "object", "additionalProperties": {"type": "integer"}},
            "nullableField": {"anyOf": [{"type": "null"}, {"type": "integer"}]},
            "arrayField": {"type": "array", "items": {"$ref": "#/$defs/Thing"}},
            "enumField": {"type": "string", "enum": ["owner", "viewer"]},
        },
        "required": ["dictField", "nullableField", "arrayField", "enumField"],
    }

    rendered = schema_gen.render_from_json_schema(schema, fake_defs, 0)
    assert "dictField: Record<string, number>;" in rendered
    assert "nullableField: null | number;" in rendered
    assert "arrayField: {" in rendered
    assert "k: string;" in rendered
    assert "enumField: string;" in rendered


def test_record_detection_does_not_rely_on_special_key_patterns():
    schema = {
        "type": "object",
        "properties": {
            "normalMap": {
                "type": "object",
                "additionalProperties": {"type": "string"},
            }
        },
        "required": ["normalMap"],
    }
    rendered = schema_gen.render_from_json_schema(schema, {}, 0)
    assert "normalMap: Record<string, string>;" in rendered
