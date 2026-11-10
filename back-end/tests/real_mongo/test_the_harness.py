"""The harness itself, on a real server: each test's own database, every handle bound to it, the
boot's indexes, a signed-in organizer and their market, and the two ways requests meet."""
import re
import threading

import pytest
from pymongo.collection import Collection

from conftest import UNREACHABLE_MONGODB_URI
from real_mongo import harness


class TestADatabaseOfItsOwn:
    def test_each_test_has_one_named_by_the_prefix(self, real_db):
        assert re.fullmatch(r"real_mongo_[0-9a-f]{12}", real_db.name)

    def test_it_is_dropped_when_its_block_passes(self, real_mongo_client):
        with harness.fresh_database(real_mongo_client) as db:
            db["markets"].insert_one({"id": "kept-for-the-block"})
            assert db.name in real_mongo_client.list_database_names()
        assert db.name not in real_mongo_client.list_database_names()

    def test_it_is_dropped_when_its_block_fails(self, real_mongo_client):
        with pytest.raises(RuntimeError):
            with harness.fresh_database(real_mongo_client) as db:
                db["markets"].insert_one({"id": "kept-for-the-block"})
                raise RuntimeError("the test failed")
        assert db.name not in real_mongo_client.list_database_names()

    def test_dropping_one_leaves_every_other(self, real_mongo_client):
        with harness.fresh_database(real_mongo_client) as outer:
            outer["markets"].insert_one({"id": "the-other-database"})
            with harness.fresh_database(real_mongo_client) as inner:
                inner["markets"].insert_one({"id": "this-one"})
            assert inner.name not in real_mongo_client.list_database_names()
            assert outer["markets"].find_one({"id": "the-other-database"})


class TestEveryHandleIsBound:
    def test_no_handle_still_names_the_unreachable_client(self, real_db):
        assert harness.stray_handles(real_db) == []
        unreachable = UNREACHABLE_MONGODB_URI.split("//")[1].split("/")[0]
        for module in harness.back_end_modules():
            for attribute, value in vars(module).items():
                if isinstance(value, Collection):
                    assert value.database.name == real_db.name, f"{module.__name__}.{attribute}"
                    assert unreachable not in repr(value.database.client), attribute

    def test_a_write_through_a_modules_handle_lands_in_the_test_database(
            self, real_db, real_mongo_client):
        import api.markets as MarketsApi
        import db_config

        MarketsApi.markets_collection.insert_one({"id": "written-through-the-module"})
        db_config.get_database()["users"].insert_one({"id": "written-through-get-database"})

        own = real_mongo_client[real_db.name]
        assert own["markets"].find_one({"id": "written-through-the-module"})
        assert own["users"].find_one({"id": "written-through-get-database"})

    def test_the_suite_wide_fakes_are_the_real_collections(
            self, real_db, applications, market_records, sign_in_attempts):
        from gridfs import GridFS

        for collection in (applications, sign_in_attempts,
                           *(value for key, value in vars(market_records).items() if key != "images")):
            assert isinstance(collection, Collection)
            assert collection.database.name == real_db.name
        assert isinstance(market_records.images, GridFS)
        assert market_records.images._collection.database.name == real_db.name


class TestTheBootsIndexes:
    def test_every_index_the_boot_builds_is_built(self, boot_indexes):
        import api.applications as ApplicationsApi
        import api.users as UsersApi

        applications = boot_indexes["applications"].index_information()
        assert applications[ApplicationsApi.APPLICANT_IDENTITY_INDEX]["unique"]
        assert boot_indexes["users"].index_information()[UsersApi.USER_EMAIL_INDEX]["unique"]
        challenges = boot_indexes["applicant_login_challenges"].index_information()
        assert challenges["market_email_unique"]["unique"]
        assert [("id", 1)] in [info["key"] for info in boot_indexes["markets"].index_information().values()]


class TestSignedIn:
    def test_the_client_is_signed_in_through_login(self, signed_in, real_db):
        client = signed_in("fixture-organizer@example.com")

        response = client.get("/check-session")

        assert response.status_code == 200
        assert response.get_json() == {"email": "fixture-organizer@example.com"}
        stored = real_db["users"].find_one({"email": "fixture-organizer@example.com"})
        assert stored["id"] == client.account_id and stored["email_verified"]

    def test_a_client_that_did_not_sign_in_is_not(self, signed_in):
        import app as app_module

        signed_in("fixture-organizer@example.com")

        assert app_module.app.test_client().get("/check-session").status_code == 401


class TestAMarketToWorkOn:
    def test_the_organizer_owns_the_market_it_inserts(self, signed_in, market_in, real_db):
        from datatypes import MarketPhase

        client = signed_in("fixture-organizer@example.com")
        market = market_in(MarketPhase.DRAFT)

        response = client.get(f"/markets/{market['id']}")

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["market"]["name"] == market["name"]
        stored = real_db["markets"].find_one({"id": market["id"]})
        assert stored["roles"] == {client.account_id: "owner"}
        assert stored["phase"] == "draft" and stored["setupObject"]["marketDates"]

    def test_overrides_are_stored(self, signed_in, market_in, real_db):
        from datatypes import MarketPhase

        signed_in("fixture-organizer@example.com")
        market = market_in(MarketPhase.DRAFT, name="Fixture Spring Market")

        assert real_db["markets"].find_one({"id": market["id"]})["name"] == "Fixture Spring Market"


class TestInterleave:
    def test_a_write_lands_between_a_requests_read_and_its_write(
            self, signed_in, market_in, interleave, real_db):
        from datatypes import MarketPhase

        client = signed_in("fixture-organizer@example.com")
        market = market_in(MarketPhase.DRAFT, name="Fixture Old Name")
        seen_between = []

        def then():
            # The rename has read the market and not yet written it.
            seen_between.append(real_db["markets"].find_one({"id": market["id"]})["name"])
            real_db["interleaved"].insert_one({"market": market["id"]})

        interleave("api.markets._load_market_to_change", then)
        response = client.put(f"/markets/{market['id']}/name", json={"name": "Fixture New Name"})

        assert response.status_code == 200, response.get_json()
        assert seen_between == ["Fixture Old Name"]
        assert real_db["interleaved"].count_documents({"market": market["id"]}) == 1
        assert real_db["markets"].find_one({"id": market["id"]})["name"] == "Fixture New Name"


class TestRace:
    def test_n_threads_are_released_together_on_the_server(self, race, real_db):
        n = 8
        counter = real_db["race_counter"]
        counter.insert_one({"_id": "count", "n": 0})
        all_inside = threading.Barrier(n, timeout=10)

        def add_one(_i):
            from pymongo import ReturnDocument

            all_inside.wait()  # passes only when every thread is inside at once
            return counter.find_one_and_update(
                {"_id": "count"}, {"$inc": {"n": 1}}, return_document=ReturnDocument.AFTER)["n"]

        results = race(n, add_one)

        assert sorted(results) == list(range(1, n + 1))
        assert counter.find_one({"_id": "count"})["n"] == n

    def test_each_thread_makes_its_own_request(self, race, signed_in):
        import app as app_module

        signed_in("fixture-organizer@example.com")

        def sign_in(i):
            client = app_module.app.test_client()
            return client.post("/login", json={
                "email": "fixture-organizer@example.com", "password": "fixture-password-1",
            }).status_code

        assert race(4, sign_in) == [200, 200, 200, 200]
