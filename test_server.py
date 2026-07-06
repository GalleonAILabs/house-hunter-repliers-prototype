#!/usr/bin/env python3
"""Tests for server.py (T9, D5).

Stdlib unittest only, matching the project's no-pip-deps rule. Each test
spins up a real server (ThreadingHTTPServer, an ephemeral port) against an
isolated temp SQLite db and a small fixture POC dataset, so tests exercise
the actual HTTP routing in server.Handler, not just isolated functions.
"""
from __future__ import annotations

import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server

FIXTURE_POC = {
    "count": 2,
    "properties": [
        {
            "row": 2,
            "address": "1 Test St",
            "beds": 2,
            "bedsNum": 2,
            "markRank": 4,
            "katieRank": "",
            "markComments": "Nice place",
            "katieComments": "",
            "rejBy": "",
            "rejReason": "",
        },
        {
            "row": 3,
            "address": "2 Test St",
            "beds": 5,
            "bedsNum": 5,
            "markRank": "",
            "katieRank": 5,
            "markComments": "",
            "katieComments": "Love it",
            "rejBy": "Mark",
            "rejReason": "too small",
        },
        {
            # Composite "beds" string (main + basement bedrooms), like real
            # POC sheet rows -- regression fixture for the maxBeds/minBeds
            # TypeError bug (comparing str to float when "beds" isn't a
            # plain number). No feedback fields set: must not affect the
            # backfill-count assertions in BackfillTests.
            "row": 4,
            "address": "3 Test St",
            "beds": "3+1",
            "bedsNum": 3,
            "markRank": "",
            "katieRank": "",
            "markComments": "",
            "katieComments": "",
            "rejBy": "",
            "rejReason": "",
        },
        {
            # T15 fixture: a condo row with the fee fields real POC rows
            # don't have today. Proves condoFeeNum/isCondo surface when
            # present, distinct from the rows above where they're absent.
            "row": 5,
            "address": "4 Test St",
            "beds": 2,
            "bedsNum": 2,
            "isCondo": True,
            "condoFeeNum": 350,
            "markRank": "",
            "katieRank": "",
            "markComments": "",
            "katieComments": "",
            "rejBy": "",
            "rejReason": "",
        },
    ],
}


class ServerTestCase(unittest.TestCase):
    """Spins up a real server against an isolated temp DB per test."""

    TOKEN = "test-token-123"

    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "test.db"
        self.poc_path = Path(self.tmpdir) / "poc_listings.json"
        self.poc_path.write_text(json.dumps(FIXTURE_POC))

        self._orig_db_path = server.DB_PATH
        self._orig_poc_path = server.POC_DATA_PATH
        self._orig_token = server.APP_AUTH_TOKEN
        self._orig_poc_ids = server.POC_LISTING_IDS
        server.DB_PATH = self.db_path
        server.POC_DATA_PATH = self.poc_path
        server.APP_AUTH_TOKEN = self.TOKEN

        server.init_db()
        server.backfill_poc_feedback()
        server.load_poc_listing_ids()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.DB_PATH = self._orig_db_path
        server.POC_DATA_PATH = self._orig_poc_path
        server.APP_AUTH_TOKEN = self._orig_token
        server.POC_LISTING_IDS = self._orig_poc_ids
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def request(self, method: str, path: str, body=None, token=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {}
        if token:
            headers["X-App-Token"] = token
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.url(path), data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.loads(exc.read().decode("utf-8"))


class SchemaTests(ServerTestCase):
    def test_tables_created(self) -> None:
        conn = server.get_db()
        try:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }
        finally:
            conn.close()
        self.assertIn("people", tables)
        self.assertIn("listing_feedback", tables)
        self.assertIn("household_settings", tables)
        self.assertIn("potential_purchase_prices", tables)

    def test_wal_mode_enabled(self) -> None:
        conn = server.get_db()
        try:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(mode.lower(), "wal")

    def test_seed_people_present_and_idempotent(self) -> None:
        conn = server.get_db()
        try:
            rows = conn.execute("SELECT name, role FROM people ORDER BY id").fetchall()
        finally:
            conn.close()
        self.assertEqual(
            [(r["name"], r["role"]) for r in rows],
            [("Mark", "buyer"), ("Katie", "buyer"), ("Anees", "advisor"), ("Kevin", "advisor")],
        )
        server.init_db()
        server.init_db()
        conn = server.get_db()
        try:
            count = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 4)


class BackfillTests(ServerTestCase):
    def test_backfill_counts_match_fixture(self) -> None:
        # Mark: rating(row2) + note(row2) + reject(row3) = 3
        # Katie: rating(row3) + note(row3) = 2
        conn = server.get_db()
        try:
            count = conn.execute("SELECT COUNT(*) FROM listing_feedback").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 5)

    def test_backfill_idempotent_on_rerun(self) -> None:
        server.backfill_poc_feedback()
        server.backfill_poc_feedback()
        conn = server.get_db()
        try:
            count = conn.execute("SELECT COUNT(*) FROM listing_feedback").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 5)


class PeopleEndpointTests(ServerTestCase):
    def test_get_people_without_token_401(self) -> None:
        status, data = self.request("GET", "/api/people")
        self.assertEqual(status, 401)
        self.assertEqual(data["error"], "unauthorized")

    def test_get_people_with_wrong_token_401(self) -> None:
        status, data = self.request("GET", "/api/people", token="wrong-token")
        self.assertEqual(status, 401)

    def test_get_people_with_correct_token_200(self) -> None:
        status, data = self.request("GET", "/api/people", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual([p["name"] for p in data["people"]], ["Mark", "Katie", "Anees", "Kevin"])


class FeedbackReadTests(ServerTestCase):
    def test_batch_feedback_returns_all_people_per_listing(self) -> None:
        status, data = self.request("GET", "/api/feedback?listing_ids=POC-2,POC-3", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertIn("POC-2", data["feedback"])
        self.assertIn("POC-3", data["feedback"])
        self.assertEqual(len(data["feedback"]["POC-2"]), 4)

    def test_latest_state_reflects_backfill(self) -> None:
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        mark = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Mark")
        self.assertEqual(mark["rating"], 4)
        self.assertEqual(mark["note"], "Nice place")
        katie = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Katie")
        self.assertIsNone(katie["rating"])

    def test_listing_with_no_feedback_returns_nulls(self) -> None:
        status, data = self.request("GET", "/api/feedback?listing_ids=POC-999", token=self.TOKEN)
        self.assertEqual(status, 200)
        for entry in data["feedback"]["POC-999"]:
            self.assertIsNone(entry["rating"])
            self.assertIsNone(entry["status"])
            self.assertFalse(entry["research_requested"])

    def test_feedback_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/feedback?listing_ids=POC-2")
        self.assertEqual(status, 401)

    def test_independent_latest_per_action_type(self) -> None:
        # Mark already has a reject on POC-3 (from backfill); rating him too
        # must not clobber the reject status/reason (D2).
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-3", "action_type": "rating", "rating": 2},
        )
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-3", token=self.TOKEN)
        mark = next(p for p in data["feedback"]["POC-3"] if p["person_name"] == "Mark")
        self.assertEqual(mark["rating"], 2)
        self.assertEqual(mark["status"], "rejected")
        self.assertEqual(mark["reason"], "too small")

    def test_research_note_surfaced_separately_from_note(self) -> None:
        # research_request's question text must not clobber, or be clobbered
        # by, a regular note on the same person/listing.
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "note", "note": "Nice place"},
        )
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "research_request",
                  "note": "What's the zoning history here?"},
        )
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        mark = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Mark")
        self.assertEqual(mark["note"], "Nice place")
        self.assertEqual(mark["research_note"], "What's the zoning history here?")
        self.assertTrue(mark["research_requested"])
        self.assertIsNone(mark["status"])

    def test_reject_and_research_request_both_visible_independently(self) -> None:
        # Regression test for the TODOS.md bug: reject and research_request
        # used to share one "status" field, so whichever action landed last
        # in read-side processing order silently won, hiding the other. The
        # underlying listing_feedback rows were never actually lost, only
        # collapsed on read. Both must now be independently true and visible
        # regardless of which action was submitted first.
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "reject", "reason": "too small"},
        )
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "research_request",
                  "note": "Worth a second look if the lot is bigger than it looks?"},
        )
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        mark = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Mark")
        self.assertEqual(mark["status"], "rejected")
        self.assertEqual(mark["reason"], "too small")
        self.assertTrue(mark["research_requested"])
        self.assertEqual(mark["research_note"], "Worth a second look if the lot is bigger than it looks?")

    def test_research_request_then_reject_still_both_visible(self) -> None:
        # Same case, opposite submission order, to confirm the fix does not
        # depend on which action happens to be processed first.
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "research_request",
                  "note": "What's the flood zone status?"},
        )
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "reject", "reason": "too far"},
        )
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        katie = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Katie")
        self.assertEqual(katie["status"], "rejected")
        self.assertEqual(katie["reason"], "too far")
        self.assertTrue(katie["research_requested"])
        self.assertEqual(katie["research_note"], "What's the flood zone status?")

    def test_note_history_keeps_every_note_newest_first(self) -> None:
        # T11: the write path has always been append-only; the read side
        # must surface the full history, not just the latest note.
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "note", "note": "Second note"},
        )
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        mark = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Mark")
        self.assertEqual(mark["note"], "Second note")
        self.assertIsNotNone(mark["note_created_at"])
        history = mark["note_history"]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["note"], "Second note")
        self.assertEqual(history[1]["note"], "Nice place")

    def test_two_people_rate_independently(self) -> None:
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "rating", "rating": 1},
        )
        self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "rating", "rating": 5},
        )
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        mark = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Mark")
        katie = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Katie")
        self.assertEqual(mark["rating"], 1)
        self.assertEqual(katie["rating"], 5)


class FeedbackWriteTests(ServerTestCase):
    def test_post_valid_rating_200(self) -> None:
        status, data = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "rating", "rating": 3},
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertIn("id", data)
        self.assertIn("created_at", data)

    def test_post_unknown_person_400(self) -> None:
        status, data = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 999, "listing_id": "POC-2", "action_type": "rating", "rating": 3},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_unknown_poc_listing_400(self) -> None:
        status, data = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-99999", "action_type": "rating", "rating": 3},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_listing")

    def test_post_repliers_style_id_not_existence_checked(self) -> None:
        status, _ = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "MLS-12345", "action_type": "note", "note": "ok"},
        )
        self.assertEqual(status, 200)

    def test_post_invalid_action_type_400(self) -> None:
        status, data = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "bogus"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_missing_listing_id_400(self) -> None:
        status, data = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 1, "action_type": "rating", "rating": 3},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_without_token_401(self) -> None:
        status, data = self.request(
            "POST", "/api/feedback",
            body={"person_id": 1, "listing_id": "POC-2", "action_type": "rating", "rating": 3},
        )
        self.assertEqual(status, 401)

    def test_post_malformed_json_400(self) -> None:
        req = urllib.request.Request(
            self.url("/api/feedback"),
            data=b"not json",
            headers={"X-App-Token": self.TOKEN, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                status, body = resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            with exc:
                status, body = exc.code, exc.read()
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_reject_defaults_status(self) -> None:
        status, _ = self.request(
            "POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "reject", "reason": "too far"},
        )
        self.assertEqual(status, 200)
        _, data = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        katie = next(p for p in data["feedback"]["POC-2"] if p["person_name"] == "Katie")
        self.assertEqual(katie["status"], "rejected")
        self.assertEqual(katie["reason"], "too far")


class PocListingsFilterTests(ServerTestCase):
    """Covers /api/poc-listings query-param filtering, including the
    minBeds/maxBeds regression: POC "beds" can be a composite display
    string ("3+1") that isn't directly numeric-comparable."""

    def test_max_beds_handles_composite_beds_string(self) -> None:
        status, data = self.request("GET", "/api/poc-listings?maxBeds=3")
        self.assertEqual(status, 200)
        addresses = {item["address"] for item in data["listings"]}
        self.assertIn("3 Test St", addresses)  # beds="3+1", bedsNum=3
        self.assertNotIn("2 Test St", addresses)  # beds=5

    def test_min_beds_handles_composite_beds_string(self) -> None:
        status, data = self.request("GET", "/api/poc-listings?minBeds=4")
        self.assertEqual(status, 200)
        addresses = {item["address"] for item in data["listings"]}
        self.assertNotIn("3 Test St", addresses)  # beds="3+1", bedsNum=3
        self.assertIn("2 Test St", addresses)  # beds=5

    def test_no_filter_params_returns_every_listing(self) -> None:
        # Regression guard for the "0 of 105 listings shown" incident: a
        # request with no filter params at all (the server-side equivalent
        # of every filter field being empty/default) must return every
        # listing, never an empty result. The incident's real cause was a
        # stale search term persisted client-side, not a server-side
        # filtering bug, but this locks down the server's half of that
        # guarantee regardless.
        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["listings"]), len(FIXTURE_POC["properties"]))


class CondoFeeTests(ServerTestCase):
    """T15: condoFeeNum/isCondo are nullable fields the POC sheet doesn't
    populate yet -- must surface when present, stay null/false otherwise."""

    def test_condo_row_surfaces_fee_and_flag(self) -> None:
        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        by_address = {item["address"]: item for item in data["listings"]}
        condo = by_address["4 Test St"]
        self.assertTrue(condo["isCondo"])
        self.assertEqual(condo["condoFeeNum"], 350)

    def test_non_condo_rows_have_no_fee(self) -> None:
        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        by_address = {item["address"]: item for item in data["listings"]}
        for address in ("1 Test St", "2 Test St", "3 Test St"):
            self.assertFalse(by_address[address]["isCondo"])
            self.assertIsNone(by_address[address]["condoFeeNum"])

    def test_repliers_normalize_detects_condo_style_and_hoa_fee(self) -> None:
        listing = {
            "mlsNumber": "TEST1",
            "listPrice": 400000,
            "details": {"propertyType": "Residential", "style": "Condominium", "HOAFee": "310"},
        }
        item = server.normalize(listing)
        self.assertTrue(item["isCondo"])
        self.assertEqual(item["condoFeeNum"], 310)

    def test_repliers_normalize_non_condo_has_no_fee_flag(self) -> None:
        listing = {
            "mlsNumber": "TEST2",
            "listPrice": 400000,
            "details": {"propertyType": "Residential", "style": "Single Family Residence"},
        }
        item = server.normalize(listing)
        self.assertFalse(item["isCondo"])
        self.assertIsNone(item["condoFeeNum"])


class PoiEndpointTests(ServerTestCase):
    """T14: POI pins are shared across the whole buyer group, like listing
    feedback -- not a per-person concept, no listing_id involved."""

    def test_get_poi_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/poi")
        self.assertEqual(status, 401)

    def test_get_poi_empty_list_by_default(self) -> None:
        status, data = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(data["poi"], [])

    def test_post_poi_requires_valid_type(self) -> None:
        status, data = self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 1, "type": "not-a-real-type", "lat": 43.6, "lng": -79.4},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_poi_requires_known_person(self) -> None:
        status, data = self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 999, "type": "school", "lat": 43.6, "lng": -79.4},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_poi_then_visible_to_everyone(self) -> None:
        status, data = self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 1, "type": "school", "label": "Local elementary", "lat": 43.6, "lng": -79.4},
        )
        self.assertEqual(status, 200)
        self.assertIn("id", data)

        status, data = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["poi"]), 1)
        poi = data["poi"][0]
        self.assertEqual(poi["type"], "school")
        self.assertEqual(poi["label"], "Local elementary")
        self.assertEqual(poi["created_by_name"], "Mark")

        # A second person adding a pin does not overwrite or hide the first
        # (shared, not per-person).
        self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 2, "type": "hospital", "lat": 43.7, "lng": -79.5},
        )
        status, data = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertEqual(len(data["poi"]), 2)


class HouseholdSettingsTests(ServerTestCase):
    """Household-level settings: one shared value per key across the whole
    buyer group, not per person, like listing_feedback's shared POI pins,
    not like a per-person rating."""

    def test_get_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/household-settings")
        self.assertEqual(status, 401)

    def test_default_first_time_buyer_true_before_anyone_sets_it(self) -> None:
        status, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(data["settings"]["first_time_buyer"], "true")

    def test_default_mortgage_assumption_settings(self) -> None:
        status, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(status, 200)
        settings = data["settings"]
        self.assertEqual(settings["down_payment_pct"], "10")
        self.assertEqual(settings["interest_rate_pct"], "5.0")
        self.assertEqual(settings["amortization_years"], "30")
        self.assertEqual(settings["property_tax_pct"], "1.0")
        self.assertEqual(settings["legal_fees_flat"], "1500")
        self.assertEqual(settings["home_inspection_flat"], "500")
        self.assertEqual(settings["appraisal_flat"], "350")
        self.assertEqual(settings["title_insurance_flat"], "300")

    def test_mortgage_assumption_setting_is_editable(self) -> None:
        status, data = self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 1, "key": "interest_rate_pct", "value": "6.25"},
        )
        self.assertEqual(status, 200)
        status, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(data["settings"]["interest_rate_pct"], "6.25")

    def test_post_requires_known_key(self) -> None:
        status, data = self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 1, "key": "not_a_real_setting", "value": "true"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_requires_known_person(self) -> None:
        status, data = self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 999, "key": "first_time_buyer", "value": "false"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_then_visible_to_everyone_shared_not_per_person(self) -> None:
        status, data = self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 2, "key": "first_time_buyer", "value": "false"},
        )
        self.assertEqual(status, 200)

        status, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(data["settings"]["first_time_buyer"], "false")

    def test_post_twice_overwrites_not_appends(self) -> None:
        # One current value per key, not a history list like notes.
        self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 1, "key": "first_time_buyer", "value": "false"},
        )
        self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 2, "key": "first_time_buyer", "value": "true"},
        )
        status, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(data["settings"]["first_time_buyer"], "true")

        conn = server.get_db()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM household_settings WHERE key = 'first_time_buyer'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 1)


class PotentialPurchasePriceTests(ServerTestCase):
    """One shared price per listing, not per person, like household
    settings, not like a per-person rating."""

    def test_get_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/potential-purchase-prices?listing_ids=POC-2")
        self.assertEqual(status, 401)

    def test_get_absent_when_never_entered(self) -> None:
        status, data = self.request(
            "GET", "/api/potential-purchase-prices?listing_ids=POC-2", token=self.TOKEN,
        )
        self.assertEqual(status, 200)
        self.assertNotIn("POC-2", data["potential_purchase_prices"])

    def test_post_requires_known_person(self) -> None:
        status, data = self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 999, "listing_id": "POC-2", "price": 450000},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_requires_known_listing(self) -> None:
        status, data = self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-999999", "price": 450000},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_listing")

    def test_post_requires_positive_price(self) -> None:
        status, data = self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "price": 0},
        )
        self.assertEqual(status, 400)

    def test_post_then_visible_to_everyone_shared_not_per_person(self) -> None:
        status, data = self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "price": 450000},
        )
        self.assertEqual(status, 200)

        status, data = self.request(
            "GET", "/api/potential-purchase-prices?listing_ids=POC-2", token=self.TOKEN,
        )
        self.assertEqual(status, 200)
        entry = data["potential_purchase_prices"]["POC-2"]
        self.assertEqual(entry["price"], 450000)
        self.assertEqual(entry["updated_by_name"], "Mark")

    def test_post_twice_overwrites_not_appends(self) -> None:
        self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "price": 450000},
        )
        self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "price": 460000},
        )
        status, data = self.request(
            "GET", "/api/potential-purchase-prices?listing_ids=POC-2", token=self.TOKEN,
        )
        entry = data["potential_purchase_prices"]["POC-2"]
        self.assertEqual(entry["price"], 460000)
        self.assertEqual(entry["updated_by_name"], "Katie")

        conn = server.get_db()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM potential_purchase_prices WHERE listing_id = 'POC-2'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 1)

    def test_poc_listings_enriched_when_potential_price_differs_from_list(self) -> None:
        # POC-2 has no priceNum in the fixture (list price is None), so any
        # entered potential price differs from it and the breakdown must
        # appear.
        self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "price": 450000},
        )
        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        item = next(l for l in data["listings"] if l["mls"] == "POC-2")
        self.assertEqual(item["potentialPurchasePrice"]["price"], 450000)
        self.assertEqual(item["potentialPurchasePrice"]["updatedByName"], "Mark")
        self.assertIn("mortgageBreakdown", item)
        self.assertGreater(item["mortgageBreakdown"]["monthlyPit"], 0)

    def test_poc_listings_no_breakdown_when_potential_price_equals_list_price(self) -> None:
        fixture = json.loads(json.dumps(FIXTURE_POC))
        fixture["properties"][0]["priceNum"] = 450000
        self.poc_path.write_text(json.dumps(fixture))

        self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "price": 450000},
        )
        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        item = next(l for l in data["listings"] if l["mls"] == "POC-2")
        self.assertEqual(item["price"], 450000)
        # Still surfaced so the edit UI knows a value was entered, just no
        # recomputed breakdown, since it matches list price exactly.
        self.assertEqual(item["potentialPurchasePrice"]["price"], 450000)
        self.assertNotIn("mortgageBreakdown", item)

    def test_poc_listings_untouched_when_no_potential_price_entered(self) -> None:
        fixture = json.loads(json.dumps(FIXTURE_POC))
        fixture["properties"][0]["priceNum"] = 450000
        fixture["properties"][0]["pitNum"] = 2200
        fixture["properties"][0]["dueNum"] = 30000
        self.poc_path.write_text(json.dumps(fixture))

        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        item = next(l for l in data["listings"] if l["mls"] == "POC-2")
        self.assertNotIn("potentialPurchasePrice", item)
        self.assertNotIn("mortgageBreakdown", item)
        self.assertEqual(item["pitNum"], 2200)
        self.assertEqual(item["dueNum"], 30000)


DEFAULT_MORTGAGE_SETTINGS = {
    "first_time_buyer": "true",
    "down_payment_pct": "10",
    "interest_rate_pct": "5.0",
    "amortization_years": "30",
    "property_tax_pct": "1.0",
    "legal_fees_flat": "1500",
    "home_inspection_flat": "500",
    "appraisal_flat": "350",
    "title_insurance_flat": "300",
}


class MortgageMathTests(unittest.TestCase):
    """Pure functions, no DB or server needed. Every rate and bracket here
    was fetched directly from CMHC's, Ontario's, and Toronto's own
    published pages (see the source comments in server.py), not a
    secondary source."""

    def test_marginal_bracket_tax_ontario_ltt_known_value(self) -> None:
        # 55000*0.005 + 195000*0.01 + 150000*0.015 = 275 + 1950 + 2250 = 4475
        tax = server.marginal_bracket_tax(400_000, server.ONTARIO_LTT_BRACKETS)
        self.assertAlmostEqual(tax, 4475.0, places=2)

    def test_marginal_bracket_tax_below_first_bracket(self) -> None:
        tax = server.marginal_bracket_tax(50_000, server.ONTARIO_LTT_BRACKETS)
        self.assertAlmostEqual(tax, 50_000 * 0.005, places=2)

    def test_minimum_down_payment_under_500k_is_five_pct(self) -> None:
        self.assertAlmostEqual(server.minimum_down_payment(400_000), 20_000.0, places=2)

    def test_minimum_down_payment_between_500k_and_1_5m(self) -> None:
        # 500000*0.05 + 300000*0.10 = 25000 + 30000 = 55000
        self.assertAlmostEqual(server.minimum_down_payment(800_000), 55_000.0, places=2)

    def test_minimum_down_payment_at_exactly_1_5m_is_twenty_pct_of_whole_price(self) -> None:
        self.assertAlmostEqual(server.minimum_down_payment(1_500_000), 300_000.0, places=2)

    def test_minimum_down_payment_above_1_5m_is_twenty_pct_of_whole_price(self) -> None:
        self.assertAlmostEqual(server.minimum_down_payment(2_000_000), 400_000.0, places=2)

    def test_cmhc_premium_pct_tier_boundaries(self) -> None:
        self.assertEqual(server.cmhc_premium_pct(0.65, 25), 0.60)
        self.assertEqual(server.cmhc_premium_pct(0.6501, 25), 1.70)
        self.assertEqual(server.cmhc_premium_pct(0.75, 25), 1.70)
        self.assertEqual(server.cmhc_premium_pct(0.80, 25), 2.40)
        self.assertEqual(server.cmhc_premium_pct(0.85, 25), 2.80)
        self.assertEqual(server.cmhc_premium_pct(0.90, 25), 3.10)
        self.assertEqual(server.cmhc_premium_pct(0.95, 25), 4.00)

    def test_cmhc_premium_pct_above_95_raises(self) -> None:
        with self.assertRaises(ValueError):
            server.cmhc_premium_pct(0.96, 25)

    def test_cmhc_amortization_surcharge_applies_beyond_25_years(self) -> None:
        self.assertEqual(server.cmhc_premium_pct(0.90, 25), 3.10)
        self.assertAlmostEqual(server.cmhc_premium_pct(0.90, 30), 3.30, places=6)

    def test_monthly_mortgage_payment_zero_rate_is_exact(self) -> None:
        self.assertAlmostEqual(server.monthly_mortgage_payment(120_000, 0.0, 10), 1000.0, places=2)

    def test_monthly_mortgage_payment_matches_known_reference(self) -> None:
        # 300000 loan, 5% annual, 25 year amortization is a commonly cited
        # reference case landing in the mid 1700s per month depending on
        # the exact compounding convention used.
        payment = server.monthly_mortgage_payment(300_000, 5.0, 25)
        self.assertGreater(payment, 1700)
        self.assertLess(payment, 1800)

    def test_is_toronto_address_true_for_toronto(self) -> None:
        self.assertTrue(server.is_toronto_address("100 Queen St W, Toronto"))

    def test_is_toronto_address_case_insensitive(self) -> None:
        self.assertTrue(server.is_toronto_address("100 Queen St W, TORONTO"))

    def test_is_toronto_address_false_for_other_gta_municipality(self) -> None:
        self.assertFalse(server.is_toronto_address("1684 Vaughan Dr, Caledon"))
        self.assertFalse(server.is_toronto_address("1 Meander Clse, Mississauga"))

    def test_is_toronto_address_false_for_malformed_address(self) -> None:
        self.assertFalse(server.is_toronto_address("no comma here"))
        self.assertFalse(server.is_toronto_address(""))
        self.assertFalse(server.is_toronto_address(None))

    def test_compute_mortgage_breakdown_full_case_not_toronto(self) -> None:
        result = server.compute_mortgage_breakdown(400_000, DEFAULT_MORTGAGE_SETTINGS, is_toronto=False)
        self.assertEqual(result["downPayment"]["amount"], 40_000.0)
        self.assertFalse(result["downPayment"]["toppedUp"])
        self.assertTrue(result["cmhc"]["applies"])
        self.assertAlmostEqual(result["cmhc"]["premiumRatePct"], 3.30, places=6)  # 90% LTV tier + 30yr surcharge
        self.assertAlmostEqual(result["cmhc"]["premium"], 360_000 * 0.033, places=2)
        self.assertAlmostEqual(result["cmhc"]["pst"], result["cmhc"]["premium"] * 0.08, places=2)
        self.assertAlmostEqual(result["ontarioLtt"]["beforeRebate"], 4475.0, places=2)
        self.assertEqual(result["ontarioLtt"]["rebate"], 4000.0)
        self.assertAlmostEqual(result["ontarioLtt"]["afterRebate"], 475.0, places=2)
        self.assertFalse(result["torontoLtt"]["applies"])
        self.assertEqual(result["torontoLtt"]["afterRebate"], 0.0)
        self.assertEqual(result["fixedCostsTotal"], 2650.0)
        self.assertGreater(result["monthlyPit"], result["monthlyPrincipalInterest"])

    def test_compute_mortgage_breakdown_down_payment_topped_up(self) -> None:
        # 3% entered on an $800,000 listing is below the required blended
        # minimum ($55,000, 6.875%), so the minimum must be used instead,
        # flagged, not silently understated.
        settings = dict(DEFAULT_MORTGAGE_SETTINGS, down_payment_pct="3")
        result = server.compute_mortgage_breakdown(800_000, settings, is_toronto=False)
        self.assertTrue(result["downPayment"]["toppedUp"])
        self.assertAlmostEqual(result["downPayment"]["enteredAmount"], 24_000.0, places=2)
        self.assertAlmostEqual(result["downPayment"]["requiredMinimum"], 55_000.0, places=2)
        self.assertAlmostEqual(result["downPayment"]["amount"], 55_000.0, places=2)

    def test_compute_mortgage_breakdown_no_cmhc_at_twenty_pct_down(self) -> None:
        settings = dict(DEFAULT_MORTGAGE_SETTINGS, down_payment_pct="20")
        result = server.compute_mortgage_breakdown(500_000, settings, is_toronto=False)
        self.assertFalse(result["cmhc"]["applies"])
        self.assertEqual(result["cmhc"]["premium"], 0.0)
        self.assertEqual(result["cmhc"]["pst"], 0.0)

    def test_compute_mortgage_breakdown_toronto_adds_municipal_ltt(self) -> None:
        # Toronto MLTT on $600,000: 275 + 1950 + 2250 + (200000*0.02=4000)
        # = 8475, same bracket shape as Ontario's up to $2,000,000, an
        # extra tax on top of the provincial one, not instead of it.
        result = server.compute_mortgage_breakdown(600_000, DEFAULT_MORTGAGE_SETTINGS, is_toronto=True)
        self.assertTrue(result["torontoLtt"]["applies"])
        self.assertAlmostEqual(result["torontoLtt"]["beforeRebate"], 8475.0, places=2)
        # The $4,475 rebate cap is smaller than the bill here, so it only
        # partially offsets it, not silently to zero.
        self.assertEqual(result["torontoLtt"]["rebate"], 4475.0)
        self.assertAlmostEqual(result["torontoLtt"]["afterRebate"], 4000.0, places=2)
        # Both the provincial and municipal LTT apply at once in Toronto,
        # each with its own separate rebate.
        self.assertGreater(result["ontarioLtt"]["beforeRebate"], 0)

    def test_compute_mortgage_breakdown_not_first_time_buyer_no_rebate(self) -> None:
        settings = dict(DEFAULT_MORTGAGE_SETTINGS, first_time_buyer="false")
        result = server.compute_mortgage_breakdown(400_000, settings, is_toronto=True)
        self.assertEqual(result["ontarioLtt"]["rebate"], 0.0)
        self.assertEqual(result["torontoLtt"]["rebate"], 0.0)
        self.assertAlmostEqual(result["ontarioLtt"]["afterRebate"], result["ontarioLtt"]["beforeRebate"], places=2)


if __name__ == "__main__":
    unittest.main()
