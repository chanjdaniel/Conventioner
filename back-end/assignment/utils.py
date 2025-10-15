import re
from typing import Any, Dict

def camel_to_snake(name: str) -> str:
    """Convert a camelCase or PascalCase string to snake_case."""
    name = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    name = re.sub('([a-z0-9])([A-Z])', r'\1_\2', name)
    return name.lower()

def convert_keys_to_snake_case(obj: Any) -> Any:
    """
    Recursively convert all camelCase (or PascalCase) keys in a dict to snake_case.
    Handles nested dicts and lists.
    """
    if isinstance(obj, dict):
        new_dict: Dict[str, Any] = {}
        for key, value in obj.items():
            new_key = camel_to_snake(key)
            new_dict[new_key] = convert_keys_to_snake_case(value)
        return new_dict
    elif isinstance(obj, list):
        return [convert_keys_to_snake_case(item) for item in obj]
    else:
        return obj


def snake_to_camel(name: str) -> str:
    """Convert a snake_case string to camelCase."""
    components = name.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])

def convert_keys_to_camel_case(obj: Any) -> Any:
    """
    Recursively convert all snake_case keys in a dict to camelCase.
    Handles nested dicts and lists.
    """
    if isinstance(obj, dict):
        new_dict: Dict[str, Any] = {}
        for key, value in obj.items():
            new_key = snake_to_camel(key)
            new_dict[new_key] = convert_keys_to_camel_case(value)
        return new_dict
    elif isinstance(obj, list):
        return [convert_keys_to_camel_case(item) for item in obj]
    else:
        return obj
