"""The market's table types, their own write (T257): ``PUT /markets/:id/table-types``.

A layout's tables are sized by the market's types (``setupObject.tableTypes``): a type is a name, a
width and a depth, and a table names its type by id, so a type resized redraws every table of it.
The layout page adds, edits and removes them, and "Use saved types" adds a template's; each is a
write of the whole list here.

The write asks what a layout's save asks, in its order: the body, the market, its data, the Market
Setup row (``Actions.CHANGE_SETUP``), the archived rule, the settled setup (409: the types settle on
leaving draft with the seats), then the types' parse and bounds (``floorplan_limits``), then that no
type a table uses is taken away. The plan's own writer (``prepared_plan``) judges the plan it would
make, and only ``setupObject.tableTypes`` is written, through ``write_market``, held at the plan's
revision as read and counting it, as every write of the plan is (T274), so a layout, the plan or
other types saved in between refuse it rather than being put back or left naming a type that is
gone.
"""

import copy
import logging
import uuid
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from client_errors import BadRequestError, ConflictError, parse_failure_detail
from datatypes import AssignmentOptionObject, Market, SetupObject, TableTypeObject
from market_documents import market_doc_key
from market_write import write_market

import api.market_actions as Actions
import api.markets as MarketsApi
import floorplan_limits as FloorplanLimits
import history as History

logger = logging.getLogger(__name__)

#: The fields the write carries; anything else is refused by name, as the plan write refuses.
TABLE_TYPES_WRITE_FIELDS = ("tableTypes",)

NOT_A_LIST = "tableTypes must be a list of objects."
NO_NAME = "Each table type needs a name."
SAME_ID = "Each table type needs its own id."
#: Why a type tables use is not taken away: "12 tables are Square 4 ft. Change them first."
TYPE_IN_USE_TEMPLATE = "{count} {name}. Change {them} first."


def _same_name_refusal(name: str) -> str:
    return f"Two table types are named {name}. Give each its own name."


def _type_in_use(count: int, name: str) -> str:
    if count == 1:
        return TYPE_IN_USE_TEMPLATE.format(count="1 table is", name=name, them="it")
    return TYPE_IN_USE_TEMPLATE.format(count=f"{count:,} tables are", name=name, them="them")


def size_in_words(width_mm: float, depth_mm: float) -> str:
    """A type's size as the layout page writes it: "183 x 76 cm", to a tenth of a centimetre."""
    def cm(mm: float) -> str:
        return f"{round(mm / 10, 1):g}"
    return f"{cm(width_mm)} x {cm(depth_mm)} cm"


def _in_words(table_types: List[TableTypeObject]) -> List[Dict[str, str]]:
    """The types as the history records them: each its id, its name and its size in words."""
    return [{"id": table_type.id, "name": table_type.name,
             "size": size_in_words(table_type.width_mm, table_type.depth_mm)}
            for table_type in table_types]


def _camel(part: Any) -> Any:
    if not isinstance(part, str):
        return part
    head, *rest = part.split("_")
    return head + "".join(word[:1].upper() + word[1:] for word in rest)


def _parsed(market_id: str, sent: List[Dict[str, Any]]) -> List[TableTypeObject]:
    """The types the body sends, parsed as the plan parses them, unknown keys dropped; a name kept
    without the spaces round it, and a type sent with no id given one."""
    parsed: List[TableTypeObject] = []
    for index, raw in enumerate(sent):
        try:
            table_type = TableTypeObject.model_validate(convert_keys_to_snake_case(raw))
        except ValidationError as e:
            logger.warning("Refused table types for market %s: %s", market_id,
                           parse_failure_detail(e))
            problems = "; ".join(
                ".".join(str(_camel(part)) for part in (index, *problem["loc"]))
                + f": {problem['msg']}"
                for problem in e.errors(include_url=False, include_context=False,
                                        include_input=False))
            raise BadRequestError(f"Invalid table types: {problems}") from e
        given = raw.get("id")
        parsed.append(table_type.model_copy(update={
            "name": table_type.name.strip(),
            "id": given if isinstance(given, str) and given.strip() else str(uuid.uuid4()),
        }))
    return parsed


def _rules_refusal(table_types: List[TableTypeObject]) -> Optional[str]:
    """Why the types may not stand together, or None: a name each, no two alike, an id each."""
    if any(not table_type.name for table_type in table_types):
        return NO_NAME
    seen: Dict[str, str] = {}
    for table_type in table_types:
        key = table_type.name.casefold()
        if key in seen:
            return _same_name_refusal(seen[key])
        seen[key] = table_type.name
    if len({table_type.id for table_type in table_types}) != len(table_types):
        return SAME_ID
    return None


def _in_use_refusal(plan: Optional[SetupObject], table_types: List[TableTypeObject]) -> Optional[str]:
    """Why a type would be taken from tables that use it, or None: the first type the market's
    layouts use that the write leaves out, with how many of their tables are of it. A beta
    floorplan, of no location, holds no tables of the market's types."""
    if plan is None:
        return None
    kept = {table_type.id for table_type in table_types}
    for gone in plan.table_types:
        if gone.id in kept:
            continue
        count = sum(
            1 for floorplan in plan.floorplans or [] if floorplan.location_id is not None
            for table in floorplan.tables if table.table_type_id == gone.id)
        if count:
            return _type_in_use(count, gone.name)
    return None


def _empty_plan() -> SetupObject:
    """The plan Market Setup starts from, for a market whose plan was never saved."""
    return SetupObject(
        priority=[], market_dates=[], tiers=[], locations=[], sections=[],
        assignment_options=AssignmentOptionObject(),
    )


def save_table_types(market_id: str, body: Dict[str, Any], requesting_user: str) -> List[Dict[str, Any]]:
    """Replace the market's table types, and answer them as stored, camelCase.

    Refused 400 for a body that is not ``{tableTypes: [...]}``, for a type that does not parse,
    has no name or shares one, for more types than a market keeps or a side out of range, and for
    taking away a type tables use; 403 for someone who may not change the setup or an archived
    market; 404 for no such market; 409 once the setup has settled, and when the plan, a layout or
    the types were written between the read and the write (``MarketChanged``). Records ``table_types`` when the types changed.
    """
    extra = sorted(set(body) - set(TABLE_TYPES_WRITE_FIELDS))
    if extra:
        raise BadRequestError(
            f"The table types write carries only tableTypes; it does not accept {', '.join(extra)}.")
    sent = body.get("tableTypes")
    if not isinstance(sent, list) or not all(isinstance(one, dict) for one in sent):
        raise BadRequestError(NOT_A_LIST)

    market: Market = MarketsApi._load_market_to_change(
        market_id, requesting_user, Actions.CHANGE_SETUP)
    # The types size the seats, which settle on leaving draft (E31/F01/S02).
    settled = MarketsApi.setup_lock_reason(market)
    if settled:
        raise ConflictError(settled)

    table_types = _parsed(market_id, sent)
    refused = FloorplanLimits.table_types_refusal(table_types) or _rules_refusal(table_types)
    if refused:
        raise BadRequestError(refused)
    stored = market.setup_object
    refused = _in_use_refusal(stored, table_types)
    if refused:
        raise BadRequestError(refused)

    proposed = stored or _empty_plan()
    prepared = MarketsApi.prepared_plan(
        market, {"setupObject": convert_keys_to_camel_case(proposed.model_dump())},
        table_types=table_types)
    plan_key = market_doc_key("setup_object")
    written_plan = prepared.update[plan_key]
    # A market whose plan was never saved gains the whole plan, which reads; else the types alone.
    update = ({plan_key: written_plan} if stored is None
              else {f"{plan_key}.tableTypes": written_plan["tableTypes"]})
    # Built on the plan as read, so held at its revision as read and counted, as every write of the
    # plan is (T274): a layout, a plan or other types saved in between refuse this write
    # (``MarketChanged``) rather than being put back or left naming a type that is gone.
    write_market(market, {"$set": update},
                 revisions={MarketsApi.PLAN_REVISION_KEY: market.plan_revision})

    before = _in_words(stored.table_types if stored else [])
    after = _in_words(prepared.plan.table_types)
    History.record(
        market_id, requesting_user, Actions.CHANGE_SETUP, kind=History.TABLE_TYPES,
        detail=lambda: History.changes({"table_types": before}, {"table_types": after}),
    )
    return copy.deepcopy(written_plan["tableTypes"])
