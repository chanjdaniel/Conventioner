"""The migration to layouts (T257) gives every section and location the id a read derives, removes
every floorplan the beta saved, deletes every image no floorplan names, writes nothing on a dry run,
and changes nothing twice."""
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from bson import ObjectId

from datatypes import fill_plan_ids
from migrate_layouts import MIGRATION_ID, SCHEMA_COLLECTION, migrate

STARTED = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
BEFORE = STARTED - timedelta(days=3)


def _set_path(doc, key, value):
    head, _, tail = key.partition(".")
    if not tail:
        doc[key] = value
        return
    _set_path(doc.setdefault(head, {}), tail, value)


class FakeMarkets:
    """Markets as Mongo holds them; ``update_one`` matches the ``_id`` and the plan as read.

    ``between`` runs once, just before the first write, as another request's write would land;
    ``after_scan`` runs once, when the first read of every market has passed the last."""

    def __init__(self, docs):
        self.docs = docs
        self.writes = 0
        self.between = None
        self.after_scan = None

    def find(self, _query, _projection=None):
        for doc in [copy.deepcopy(doc) for doc in self.docs]:
            yield doc
        if self.after_scan:
            after_scan, self.after_scan = self.after_scan, None
            after_scan(self.docs)

    def update_one(self, query, update):
        if self.between:
            between, self.between = self.between, None
            between(self.docs)
        for doc in self.docs:
            if doc["_id"] == query["_id"] and doc.get("setupObject") == query["setupObject"]:
                for key, value in update["$set"].items():
                    _set_path(doc, key, copy.deepcopy(value))
                self.writes += 1
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


class FakeSchema:
    def __init__(self):
        self.markers = {}

    def update_one(self, query, update, upsert=False):
        assert upsert
        self.markers[query["_id"]] = update["$set"]


class FakeDb:
    def __init__(self, docs):
        self.markets = FakeMarkets(docs)
        self.schema = FakeSchema()

    def __getitem__(self, name):
        assert name == SCHEMA_COLLECTION
        return self.schema


class FakeImages:
    """The ``floorplan_images`` bucket: each file's id and when it was uploaded."""

    def __init__(self):
        self.files = {}

    def put(self, uploaded=BEFORE):
        file_id = ObjectId()
        self.files[file_id] = uploaded
        return str(file_id)

    def find(self, _query):
        return iter([SimpleNamespace(_id=file_id, upload_date=uploaded)
                     for file_id, uploaded in self.files.items()])

    def delete(self, file_id):
        del self.files[file_id]

    def holds(self, file_id):
        return ObjectId(file_id) in self.files


def _plan(floorplans=None, **overrides):
    plan = {
        "priority": [], "marketDates": [], "tiers": [], "assignmentOptions": {},
        "locations": [{"name": "Upper Hall"}, {"name": "Lower Hall"}],
        "sections": [
            {"name": "Gold row", "count": 9, "location": {"name": "Upper Hall"}},
            {"name": "Blue row", "count": 4, "location": {"name": "Lower Hall"}},
        ],
    }
    if floorplans is not None:
        plan["floorplans"] = floorplans
    plan.update(overrides)
    return plan


def _beta(image):
    return {"id": "fp-beta", "imageGridfsId": image, "scaleUnit": "mm", "walls": [],
            "placedTables": [], "sections": []}


def _layout(image, location="loc-upper"):
    return {"id": "fp-upper", "locationId": location, "imageGridfsId": image, "tables": []}


def _world():
    images = FakeImages()
    beta_image = images.put()
    layout_image = images.put()
    stray_image = images.put()
    fresh_image = images.put(uploaded=STARTED + timedelta(seconds=5))
    migrated = _plan([_layout(layout_image)])
    migrated["locations"] = [{"id": "loc-upper", "name": "Upper Hall"},
                             {"id": "loc-lower", "name": "Lower Hall"}]
    migrated["sections"] = [
        {"id": "sec-gold", "name": "Gold row", "count": 9,
         "location": {"id": "loc-upper", "name": "Upper Hall"}},
        {"id": "sec-blue", "name": "Blue row", "count": 4,
         "location": {"id": "loc-lower", "name": "Lower Hall"}},
    ]
    db = FakeDb([
        {"_id": 1, "id": "m1", "name": "Fixture Beta", "setupObject": _plan([_beta(beta_image)])},
        {"_id": 2, "id": "m2", "name": "Fixture No Ids", "setupObject": _plan()},
        {"_id": 3, "id": "m3", "name": "Fixture Laid Out", "setupObject": migrated},
        {"_id": 4, "id": "m4", "name": "Fixture No Plan", "setupObject": None},
    ])
    return SimpleNamespace(db=db, images=images, beta_image=beta_image,
                           layout_image=layout_image, stray_image=stray_image,
                           fresh_image=fresh_image)


def _market(world, market_id):
    return next(doc for doc in world.db.markets.docs if doc["id"] == market_id)


def _run(world, dry_run=False):
    return migrate(world.db, world.images, dry_run=dry_run, started=STARTED)


class TestIds:

    def test_every_section_and_location_gets_the_id_a_read_derives(self):
        world = _world()
        expected = fill_plan_ids(_plan())

        _run(world)

        plan = _market(world, "m2")["setupObject"]
        assert plan["locations"] == expected["locations"]
        assert plan["sections"] == expected["sections"]
        assert all(location["id"] for location in plan["locations"])
        by_name = {location["name"]: location["id"] for location in plan["locations"]}
        for section in plan["sections"]:
            assert section["id"]
            assert section["location"]["id"] == by_name[section["location"]["name"]]

    def test_a_stored_id_is_kept(self):
        world = _world()
        before = copy.deepcopy(_market(world, "m3")["setupObject"])

        _run(world)

        assert _market(world, "m3")["setupObject"] == before


class TestBetaFloorplans:

    def test_a_floorplan_with_no_location_is_removed(self):
        world = _world()

        counts = _run(world)

        assert _market(world, "m1")["setupObject"]["floorplans"] == []
        assert counts["floorplans_removed"] == 1

    def test_a_layout_of_a_location_is_kept(self):
        world = _world()

        _run(world)

        assert [fp["id"] for fp in _market(world, "m3")["setupObject"]["floorplans"]] == [
            "fp-upper"]


class TestImages:

    def test_every_image_no_floorplan_names_is_deleted(self):
        world = _world()

        counts = _run(world)

        assert not world.images.holds(world.beta_image)
        assert not world.images.holds(world.stray_image)
        assert counts["images_deleted"] == 2

    def test_an_image_a_layout_names_is_kept(self):
        world = _world()

        _run(world)

        assert world.images.holds(world.layout_image)

    def test_an_image_uploaded_after_the_run_began_is_kept(self):
        world = _world()

        _run(world)

        assert world.images.holds(world.fresh_image)


class TestTheRun:

    def test_it_records_its_marker(self):
        world = _world()

        _run(world)

        assert world.db.schema.markers == {MIGRATION_ID: {"appliedAt": STARTED.isoformat()}}

    def test_a_dry_run_writes_and_deletes_nothing_and_counts_the_same(self):
        world = _world()
        before = copy.deepcopy(world.db.markets.docs)
        files = dict(world.images.files)

        dry = _run(world, dry_run=True)

        assert world.db.markets.docs == before
        assert world.db.markets.writes == 0
        assert world.images.files == files
        assert world.db.schema.markers == {}
        assert dry == _run(_world())

    def test_a_second_run_changes_nothing(self):
        world = _world()
        _run(world)
        after = copy.deepcopy(world.db.markets.docs)
        files = dict(world.images.files)
        writes = world.db.markets.writes

        counts = _run(world)

        assert world.db.markets.docs == after
        assert world.db.markets.writes == writes
        assert world.images.files == files
        assert (counts["markets"], counts["floorplans_removed"], counts["images_deleted"]) == (
            0, 0, 0)

    def test_a_market_changed_while_it_runs_is_left_and_its_images_kept(self):
        world = _world()

        def a_save_lands(docs):
            next(doc for doc in docs if doc["id"] == "m1")["setupObject"]["tiers"] = [
                {"id": 0, "name": "Gold"}]

        world.db.markets.between = a_save_lands

        counts = _run(world)

        assert _market(world, "m1")["setupObject"]["floorplans"][0]["id"] == "fp-beta"
        assert world.images.holds(world.beta_image)
        assert counts["raced"] == 1
        assert world.db.schema.markers == {}

    def test_no_image_is_deleted_while_a_market_changed_under_the_run(self):
        world = _world()

        def a_save_lands(docs):
            next(doc for doc in docs if doc["id"] == "m1")["setupObject"]["tiers"] = [
                {"id": 0, "name": "Gold"}]

        world.db.markets.between = a_save_lands

        counts = _run(world)

        assert world.images.holds(world.stray_image)
        assert counts["images_deleted"] == 0

    def test_an_image_a_layout_names_once_its_market_was_read_is_kept(self):
        world = _world()

        def a_layout_is_saved(docs):
            market = next(doc for doc in docs if doc["id"] == "m2")
            market["setupObject"]["floorplans"] = [_layout(world.stray_image, "loc-lower")]

        world.db.markets.after_scan = a_layout_is_saved

        counts = _run(world)

        assert world.images.holds(world.stray_image)
        assert not world.images.holds(world.beta_image)
        assert counts["images_deleted"] == 1
