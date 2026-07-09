#!/usr/bin/env python3
"""Tests for server.py (T9, D5).

Stdlib unittest only, matching the project's no-pip-deps rule. Each test
spins up a real server (ThreadingHTTPServer, an ephemeral port) against an
isolated temp SQLite db and a small fixture POC dataset, so tests exercise
the actual HTTP routing in server.Handler, not just isolated functions.
"""
from __future__ import annotations

import base64
import json
import shutil
import sqlite3
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
            "lat": 43.65,
            "lon": -79.40,
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
            [("Mark", "buyer"), ("Katie", "buyer"), ("Anees", "realtor"), ("Kevin", "realtor")],
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

    def test_realtor_role_is_stored_not_mapped(self) -> None:
        # 'realtor' is now the stored value AND the displayed value, one
        # source of truth (no display-time mapping).
        _, data = self.request("GET", "/api/people", token=self.TOKEN)
        by_name = {p["name"]: p["role"] for p in data["people"]}
        self.assertEqual(by_name["Mark"], "buyer")
        self.assertEqual(by_name["Anees"], "realtor")
        self.assertEqual(by_name["Kevin"], "realtor")
        conn = server.get_db()
        try:
            stored = conn.execute("SELECT role FROM people WHERE name = 'Anees'").fetchone()[0]
            # No 'advisor' token survives in storage.
            legacy = conn.execute("SELECT COUNT(*) FROM people WHERE role = 'advisor'").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(stored, "realtor")
        self.assertEqual(legacy, 0)


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
    def test_bulk_delete_restores_prior_rating(self) -> None:
        # Append-only model: a later rating shadows an earlier one; deleting the
        # later row (bulk-undo) makes the prior one current again.
        _, first = self.request("POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "rating", "rating": 5})
        _, second = self.request("POST", "/api/feedback", token=self.TOKEN,
            body={"person_id": 2, "listing_id": "POC-2", "action_type": "rating", "rating": 1})
        # current rating is now 1
        _, fb = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        cur = next(f for f in fb["feedback"]["POC-2"] if f["person_id"] == 2)
        self.assertEqual(cur["rating"], 1)
        # undo: delete the second row
        status, out = self.request("DELETE", "/api/feedback", token=self.TOKEN, body={"ids": [second["id"]]})
        self.assertEqual(status, 200)
        self.assertEqual(out["deleted"], 1)
        _, fb2 = self.request("GET", "/api/feedback?listing_ids=POC-2", token=self.TOKEN)
        cur2 = next(f for f in fb2["feedback"]["POC-2"] if f["person_id"] == 2)
        self.assertEqual(cur2["rating"], 5)  # prior value restored automatically

    def test_bulk_delete_bad_ids_400(self) -> None:
        status, data = self.request("DELETE", "/api/feedback", token=self.TOKEN, body={"ids": []})
        self.assertEqual(status, 400)
        status2, _ = self.request("DELETE", "/api/feedback", token=self.TOKEN, body={"ids": ["x"]})
        self.assertEqual(status2, 400)

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

    def test_delete_poi_without_token_401(self) -> None:
        status, _ = self.request("DELETE", "/api/poi", body={"id": 1})
        self.assertEqual(status, 401)

    def test_delete_poi_requires_id(self) -> None:
        status, data = self.request("DELETE", "/api/poi", token=self.TOKEN, body={})
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_delete_unknown_poi_404(self) -> None:
        status, data = self.request("DELETE", "/api/poi", token=self.TOKEN, body={"id": 9999})
        self.assertEqual(status, 404)
        self.assertEqual(data["error"], "not_found")

    def test_delete_unreferenced_poi_removes_it(self) -> None:
        _, created = self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 1, "type": "school", "label": "Gone soon", "lat": 43.6, "lng": -79.4},
        )
        poi_id = created["id"]
        status, data = self.request("DELETE", "/api/poi", token=self.TOKEN, body={"id": poi_id})
        self.assertEqual(status, 200)
        self.assertEqual(data["removed_attachments"], 0)
        _, read = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertFalse(any(p["id"] == poi_id for p in read["poi"]))

    def test_delete_referenced_poi_refused_then_forced(self) -> None:
        # Attaching a new place creates a POI pin and a referencing attachment.
        _, att = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-2", "person_id": 1,
                  "new_place": {"type": "work", "label": "Job", "lat": 43.7, "lng": -79.4}},
        )
        poi_id = att["attachment"]["poi_id"]

        # Refused while referenced, and the pin is left intact.
        status, data = self.request("DELETE", "/api/poi", token=self.TOKEN, body={"id": poi_id})
        self.assertEqual(status, 409)
        self.assertEqual(data["error"], "poi_referenced")
        self.assertEqual(data["attachment_count"], 1)
        _, read = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertTrue(any(p["id"] == poi_id for p in read["poi"]))

        # force cascades: the attachment and the pin both go.
        status, data = self.request("DELETE", "/api/poi", token=self.TOKEN, body={"id": poi_id, "force": True})
        self.assertEqual(status, 200)
        self.assertEqual(data["removed_attachments"], 1)
        _, read = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertFalse(any(p["id"] == poi_id for p in read["poi"]))
        _, atts = self.request("GET", "/api/place-attachments?listing_ids=POC-2", token=self.TOKEN)
        self.assertEqual(atts["place_attachments"]["POC-2"], [])


class SavedAreaTests(ServerTestCase):
    """Named draw areas are shared across the whole buyer group like POI pins:
    a search zone is a household concept, created_by is attribution only."""

    RING = [[-79.9, 44.2], [-79.9, 44.5], [-79.6, 44.5], [-79.6, 44.2], [-79.9, 44.2]]

    def test_get_areas_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/areas")
        self.assertEqual(status, 401)

    def test_get_areas_empty_by_default(self) -> None:
        status, data = self.request("GET", "/api/areas", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(data["areas"], [])

    def test_post_area_requires_name(self) -> None:
        status, data = self.request(
            "POST", "/api/areas", token=self.TOKEN,
            body={"person_id": 1, "name": "  ", "polygon": self.RING},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_area_requires_valid_polygon(self) -> None:
        status, data = self.request(
            "POST", "/api/areas", token=self.TOKEN,
            body={"person_id": 1, "name": "Too small", "polygon": [[-79.9, 44.2], [-79.6, 44.5]]},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_area_requires_known_person(self) -> None:
        status, data = self.request(
            "POST", "/api/areas", token=self.TOKEN,
            body={"person_id": 999, "name": "Barrie", "polygon": self.RING},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_area_then_visible_to_everyone(self) -> None:
        status, data = self.request(
            "POST", "/api/areas", token=self.TOKEN,
            body={"person_id": 1, "name": "Barrie area", "polygon": self.RING},
        )
        self.assertEqual(status, 200)
        self.assertIn("id", data)
        self.assertEqual(data["polygon"], self.RING)  # round-trips

        status, data = self.request("GET", "/api/areas", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["areas"]), 1)
        area = data["areas"][0]
        self.assertEqual(area["name"], "Barrie area")
        self.assertEqual(area["polygon"], self.RING)
        self.assertEqual(area["created_by_name"], "Mark")

    def test_delete_area(self) -> None:
        _, data = self.request(
            "POST", "/api/areas", token=self.TOKEN,
            body={"person_id": 1, "name": "Orangeville", "polygon": self.RING},
        )
        area_id = data["id"]
        status, out = self.request("DELETE", "/api/areas", token=self.TOKEN, body={"id": area_id})
        self.assertEqual(status, 200)
        self.assertTrue(out["ok"])
        status, data = self.request("GET", "/api/areas", token=self.TOKEN)
        self.assertEqual(data["areas"], [])

    def test_delete_unknown_area_404(self) -> None:
        status, data = self.request("DELETE", "/api/areas", token=self.TOKEN, body={"id": 4242})
        self.assertEqual(status, 404)
        self.assertEqual(data["error"], "not_found")


class HouseholdSettingsTests(ServerTestCase):
    """Household-level settings: one shared value per key across the whole
    buyer group, not per person, like listing_feedback's shared POI pins,
    not like a per-person rating."""

    def test_get_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/household-settings")
        self.assertEqual(status, 401)

    def test_highway_km_is_a_household_setting(self) -> None:
        # Highway distance moved from per-person to household; default 5 km,
        # and it is editable through the household-settings endpoint.
        _, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(data["settings"]["highway_km"], "5")
        status, _ = self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 1, "key": "highway_km", "value": "3"},
        )
        self.assertEqual(status, 200)
        _, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(data["settings"]["highway_km"], "3")

    def test_feature_keywords_seeded_and_editable(self) -> None:
        # Household keyword features: seeded with the three that used to be
        # hardcoded so nothing is lost, and editable as a JSON list.
        _, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(json.loads(data["settings"]["feature_keywords"]), ["garage", "pool", "basement"])
        status, _ = self.request(
            "POST", "/api/household-settings", token=self.TOKEN,
            body={"person_id": 1, "key": "feature_keywords", "value": json.dumps(["garage", "fireplace"])},
        )
        self.assertEqual(status, 200)
        _, data = self.request("GET", "/api/household-settings", token=self.TOKEN)
        self.assertEqual(json.loads(data["settings"]["feature_keywords"]), ["garage", "fireplace"])

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

    def test_poc_listings_has_breakdown_even_when_potential_price_equals_list_price(self) -> None:
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
        self.assertEqual(item["potentialPurchasePrice"]["price"], 450000)
        # The computed breakdown is the default for every listing now, not
        # a special case that only appears when the override differs from
        # list price.
        self.assertIn("mortgageBreakdown", item)
        self.assertEqual(item["mortgageBreakdown"]["price"], 450000)

    def test_poc_listings_breakdown_uses_list_price_when_no_potential_price_entered(self) -> None:
        fixture = json.loads(json.dumps(FIXTURE_POC))
        fixture["properties"][0]["priceNum"] = 450000
        fixture["properties"][0]["pitNum"] = 2200
        fixture["properties"][0]["dueNum"] = 30000
        self.poc_path.write_text(json.dumps(fixture))

        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        item = next(l for l in data["listings"] if l["mls"] == "POC-2")
        self.assertNotIn("potentialPurchasePrice", item)
        # The original flat figures stay in the underlying record as a
        # reference; they are just never touched by this enrichment step.
        self.assertEqual(item["pitNum"], 2200)
        self.assertEqual(item["dueNum"], 30000)
        # List price is the base when no potential purchase price exists.
        self.assertIn("mortgageBreakdown", item)
        self.assertEqual(item["mortgageBreakdown"]["price"], 450000)

    def test_poc_listings_no_breakdown_when_no_price_at_all(self) -> None:
        # POC-2 has no priceNum in the base fixture and no potential price
        # is entered here either: nothing valid to compute a breakdown
        # against, so it must stay absent rather than compute off zero.
        status, data = self.request("GET", "/api/poc-listings")
        self.assertEqual(status, 200)
        item = next(l for l in data["listings"] if l["mls"] == "POC-2")
        self.assertIsNone(item.get("price"))
        self.assertNotIn("potentialPurchasePrice", item)
        self.assertNotIn("mortgageBreakdown", item)

    def test_delete_without_token_401(self) -> None:
        status, _ = self.request(
            "DELETE", "/api/potential-purchase-prices", body={"listing_id": "POC-2"},
        )
        self.assertEqual(status, 401)

    def test_delete_requires_known_listing(self) -> None:
        status, data = self.request(
            "DELETE", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"listing_id": "POC-999999"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_listing")

    def test_delete_when_never_entered_is_a_no_op(self) -> None:
        status, data = self.request(
            "DELETE", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"listing_id": "POC-2"},
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def test_delete_clears_price_back_to_unset_not_zero(self) -> None:
        self.request(
            "POST", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"person_id": 1, "listing_id": "POC-2", "price": 450000},
        )
        status, data = self.request(
            "GET", "/api/potential-purchase-prices?listing_ids=POC-2", token=self.TOKEN,
        )
        self.assertIn("POC-2", data["potential_purchase_prices"])

        status, data = self.request(
            "DELETE", "/api/potential-purchase-prices", token=self.TOKEN,
            body={"listing_id": "POC-2"},
        )
        self.assertEqual(status, 200)

        # Cleared means the row is gone entirely, the same "absent, not
        # present with a null/zero price" state as never having entered
        # one at all (see potential_prices_for_listings).
        status, data = self.request(
            "GET", "/api/potential-purchase-prices?listing_ids=POC-2", token=self.TOKEN,
        )
        self.assertNotIn("POC-2", data["potential_purchase_prices"])

        conn = server.get_db()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM potential_purchase_prices WHERE listing_id = 'POC-2'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 0)

        # The card-facing view reverts fully: no attribution, breakdown
        # recomputed off list price (or absent if there is none), same as
        # a listing that never had an override.
        status, data = self.request("GET", "/api/poc-listings")
        item = next(l for l in data["listings"] if l["mls"] == "POC-2")
        self.assertNotIn("potentialPurchasePrice", item)


class StaticCacheHeaderTests(ServerTestCase):
    """Static assets must be sent no-cache so a deploy is never masked by a
    stale browser/edge copy of index.html/app.js/styles.css."""

    def test_static_asset_sent_no_cache(self) -> None:
        req = urllib.request.Request(self.url("/styles.css"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get("Cache-Control"), "no-cache")


class PersonThresholdsTests(ServerTestCase):
    """Per-person location thresholds: per person in structure (one row per
    person), but stored server-side and shared with the whole group like
    household settings, editable by anyone. Buyers are seeded with the
    migrated 20-min nearest-GO rule and a 5 km highway limit; realtors get
    no thresholds."""

    def test_get_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/person-thresholds")
        self.assertEqual(status, 401)

    def test_get_returns_buyers_only_not_realtors(self) -> None:
        status, data = self.request("GET", "/api/person-thresholds", token=self.TOKEN)
        self.assertEqual(status, 200)
        thresholds = data["person_thresholds"]
        # Mark(1), Katie(2) are buyers; Anees(3), Kevin(4) are realtors and
        # must be absent -- thresholds are a buyer-only concept.
        self.assertEqual(set(thresholds.keys()), {"1", "2"})

    def test_buyers_seeded_with_migrated_go_travel(self) -> None:
        _, data = self.request("GET", "/api/person-thresholds", token=self.TOKEN)
        for pid in ("1", "2"):  # Mark, Katie
            entry = data["person_thresholds"][pid]
            self.assertEqual(entry["travel_minutes"], 20)
            self.assertEqual(entry["travel_mode"], "drive")
            self.assertEqual(entry["travel_dest_kind"], "go_station")
            self.assertIsNone(entry["travel_dest_ref"])  # nearest GO station
            # highway distance is a household setting now, not per person.
            self.assertNotIn("highway_km", entry)
            # Migration default, not an edit anyone made.
            self.assertIsNone(entry["updated_by"])

    def test_realtors_absent_and_not_storable(self) -> None:
        # Realtors (Anees=3, Kevin=4) never appear in the roster...
        _, data = self.request("GET", "/api/person-thresholds", token=self.TOKEN)
        self.assertNotIn("3", data["person_thresholds"])
        self.assertNotIn("4", data["person_thresholds"])
        # ...and thresholds cannot be stored for one.
        status, data = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 3, "actor_id": 1, "travel_minutes": 20},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "not_a_buyer")

    def test_init_db_removes_any_seeded_realtor_rows(self) -> None:
        # A row keyed to a realtor (e.g. stored before the buyer-only rule)
        # is cleaned out by init_db and never surfaces.
        conn = server.get_db()
        try:
            conn.execute(
                "INSERT INTO person_thresholds (person_id, travel_minutes, updated_by) VALUES (3, 20, 1)"
            )
            conn.commit()
        finally:
            conn.close()
        server.init_db()  # idempotent; must delete the realtor row
        conn = server.get_db()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM person_thresholds WHERE person_id = 3"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 0)

    def test_post_requires_known_target_person(self) -> None:
        status, data = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 999, "actor_id": 1, "travel_minutes": 20},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_requires_known_actor(self) -> None:
        status, data = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 1, "actor_id": 999, "travel_minutes": 20},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_rejects_bad_travel_mode(self) -> None:
        status, data = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 1, "actor_id": 1, "travel_mode": "teleport"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_post_rejects_bad_dest_kind(self) -> None:
        status, data = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 1, "actor_id": 1, "travel_dest_kind": "address"},
        )
        self.assertEqual(status, 400)

    def test_anyone_can_edit_anyone_shared_not_per_device(self) -> None:
        # Katie (actor 2) sets Mark's (target 1) thresholds; everyone sees it.
        status, _ = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 1, "actor_id": 2, "travel_minutes": 30,
                  "travel_total_minutes": 100, "travel_mode": "drive",
                  "travel_dest_kind": "poi", "travel_dest_ref": "7"},
        )
        self.assertEqual(status, 200)
        _, data = self.request("GET", "/api/person-thresholds", token=self.TOKEN)
        mark = data["person_thresholds"]["1"]
        self.assertEqual(mark["travel_minutes"], 30)
        self.assertEqual(mark["travel_total_minutes"], 100)
        self.assertEqual(mark["travel_dest_kind"], "poi")
        self.assertEqual(mark["travel_dest_ref"], "7")
        # Attribution now names Katie, the actor who made the change.
        self.assertEqual(mark["updated_by_name"], "Katie")

    def test_post_is_full_replace_omitted_fields_become_null(self) -> None:
        # Mark starts seeded (travel_minutes=20). A POST that omits
        # travel_minutes clears it back to unset (full replace).
        self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 1, "actor_id": 1, "travel_total_minutes": 90},
        )
        _, data = self.request("GET", "/api/person-thresholds", token=self.TOKEN)
        mark = data["person_thresholds"]["1"]
        self.assertEqual(mark["travel_total_minutes"], 90)
        self.assertIsNone(mark["travel_minutes"])
        self.assertIsNone(mark["travel_mode"])

    def test_post_rejects_non_finite_numbers(self) -> None:
        # Python's json parses Infinity/NaN; the validators must reject both
        # rather than 500-ing on int(round(inf)). Sent as raw JSON tokens.
        for field, literal in [
            ("travel_minutes", "Infinity"),
            ("travel_minutes", "NaN"),
            ("travel_total_minutes", "Infinity"),
        ]:
            raw = f'{{"person_id": 1, "actor_id": 1, "{field}": {literal}}}'
            req = urllib.request.Request(
                self.url("/api/person-thresholds"), data=raw.encode("utf-8"),
                headers={"X-App-Token": self.TOKEN, "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    status, body = resp.status, resp.read()
            except urllib.error.HTTPError as exc:
                with exc:
                    status, body = exc.code, exc.read()
            self.assertEqual(status, 400, f"{field}={literal} should be rejected")
            self.assertEqual(json.loads(body)["error"], "invalid_request")

    def test_post_rejects_boolean_person_id(self) -> None:
        # bool is an int subclass; true must not be accepted as person id 1.
        status, data = self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": True, "actor_id": 1, "travel_minutes": 20},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "unknown_person")

    def test_post_twice_overwrites_not_appends(self) -> None:
        self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 2, "actor_id": 1, "travel_minutes": 15},
        )
        self.request(
            "POST", "/api/person-thresholds", token=self.TOKEN,
            body={"person_id": 2, "actor_id": 1, "travel_minutes": 25},
        )
        conn = server.get_db()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM person_thresholds WHERE person_id = 2"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 1)


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


class PlaceAttachmentTests(ServerTestCase):
    """Per-property place attachments: attach a POI (existing or new) to a
    listing, shared across the group, straight-line distance immediately, drive
    time cached. Mapbox is nulled here so no network call is made; drive fields
    come back null (routing-unavailable path), exercised for real on the live
    domain instead."""

    def setUp(self) -> None:
        super().setUp()
        self._orig_mapbox = server.MAPBOX_TOKEN
        server.MAPBOX_TOKEN = ""  # no network call; mapbox_drive returns (None, None)

    def tearDown(self) -> None:
        server.MAPBOX_TOKEN = self._orig_mapbox
        super().tearDown()

    def test_get_without_token_401(self) -> None:
        status, _ = self.request("GET", "/api/place-attachments?listing_ids=POC-2")
        self.assertEqual(status, 401)

    def test_attach_new_place_creates_poi_and_computes_straight_km(self) -> None:
        status, data = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-2", "person_id": 1,
                  "new_place": {"type": "work", "label": "Office", "lat": 43.70, "lng": -79.40}},
        )
        self.assertEqual(status, 200, data)
        att = data["attachment"]
        self.assertEqual(att["poi_label"], "Office")
        self.assertEqual(att["created_by_name"], "Mark")
        # ~0.05 deg latitude north of the listing is ~5.5 km straight-line.
        self.assertAlmostEqual(att["straight_km"], 5.56, delta=0.1)
        self.assertIsNone(att["drive_minutes"])  # mapbox nulled in tests
        # A POI pin was created (one source of truth for places).
        _, poi = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertTrue(any(p["label"] == "Office" for p in poi["poi"]))

    def test_attach_existing_poi_and_shared_read(self) -> None:
        # Create a POI, then attach it by id.
        _, poi = self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 2, "type": "school", "label": "School", "lat": 43.66, "lng": -79.41},
        )
        poi_id = poi["id"]
        status, data = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-2", "person_id": 2, "poi_id": poi_id},
        )
        self.assertEqual(status, 200, data)
        # Visible to everyone reading the listing.
        _, read = self.request("GET", "/api/place-attachments?listing_ids=POC-2", token=self.TOKEN)
        atts = read["place_attachments"]["POC-2"]
        self.assertEqual(len(atts), 1)
        self.assertEqual(atts[0]["poi_id"], poi_id)
        self.assertEqual(atts[0]["created_by_name"], "Katie")

    def test_duplicate_attachment_rejected(self) -> None:
        _, poi = self.request(
            "POST", "/api/poi", token=self.TOKEN,
            body={"person_id": 1, "type": "work", "lat": 43.66, "lng": -79.41},
        )
        body = {"listing_id": "POC-2", "person_id": 1, "poi_id": poi["id"]}
        self.request("POST", "/api/place-attachments", token=self.TOKEN, body=body)
        status, data = self.request("POST", "/api/place-attachments", token=self.TOKEN, body=body)
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "already_attached")

    def test_attach_requires_known_person_and_listing(self) -> None:
        s1, _ = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-2", "person_id": 999,
                  "new_place": {"type": "work", "lat": 43.7, "lng": -79.4}},
        )
        self.assertEqual(s1, 400)
        s2, _ = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-99999", "person_id": 1,
                  "new_place": {"type": "work", "lat": 43.7, "lng": -79.4}},
        )
        self.assertEqual(s2, 400)

    def test_attach_rejects_listing_without_coords(self) -> None:
        # POC-4 ("3 Test St") has no lat/lon in the fixture.
        status, data = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-4", "person_id": 1,
                  "new_place": {"type": "work", "lat": 43.7, "lng": -79.4}},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "no_listing_coords")

    def test_delete_attachment_leaves_poi(self) -> None:
        _, data = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-2", "person_id": 1,
                  "new_place": {"type": "work", "label": "Job", "lat": 43.7, "lng": -79.4}},
        )
        att_id = data["attachment"]["id"]
        status, _ = self.request("DELETE", "/api/place-attachments", token=self.TOKEN, body={"id": att_id})
        self.assertEqual(status, 200)
        _, read = self.request("GET", "/api/place-attachments?listing_ids=POC-2", token=self.TOKEN)
        self.assertEqual(read["place_attachments"]["POC-2"], [])
        # POI pin survives (shared, may be attached elsewhere).
        _, poi = self.request("GET", "/api/poi", token=self.TOKEN)
        self.assertTrue(any(p["label"] == "Job" for p in poi["poi"]))

    def test_recompute_updates_row(self) -> None:
        _, data = self.request(
            "POST", "/api/place-attachments", token=self.TOKEN,
            body={"listing_id": "POC-2", "person_id": 1,
                  "new_place": {"type": "work", "lat": 43.7, "lng": -79.4}},
        )
        att_id = data["attachment"]["id"]
        status, data = self.request(
            "POST", "/api/place-attachments/recompute", token=self.TOKEN, body={"id": att_id})
        self.assertEqual(status, 200)
        self.assertAlmostEqual(data["attachment"]["straight_km"], 5.56, delta=0.1)

    def test_mapbox_drive_returns_none_without_token(self) -> None:
        self.assertEqual(server.mapbox_drive(43.6, -79.4, 43.7, -79.5), (None, None))


class ReportIssueTests(ServerTestCase):
    """GAL-42 in-app issue reporter. The Linear and Anthropic calls are the
    named module-level seams monkeypatched here, so no network is touched and
    no live API keys are needed. The handler calls them as module globals, so
    replacing server.<name> takes effect for the live threaded server."""

    SEAMS = (
        "LINEAR_API_KEY", "ANTHROPIC_API_KEY", "REPORT_IMAGE_MAX_BYTES",
        "linear_resolve_triage_context", "linear_open_triage_titles",
        "linear_upload_image", "linear_create_issue", "anthropic_triage_firstpass",
    )

    def setUp(self) -> None:
        super().setUp()
        self._seam_orig = {name: getattr(server, name) for name in self.SEAMS}
        server._REPORT_TRIAGE_CACHE = None
        server.LINEAR_API_KEY = "lin_api_test"
        server.ANTHROPIC_API_KEY = "sk-ant-test"

        self.created: list[dict] = []
        self.uploaded: list[dict] = []
        server.linear_resolve_triage_context = lambda: {
            "team_id": "team-1", "triage_state_id": "state-1",
            "labels": {"bug": "lbl-bug", "improvement": "lbl-imp",
                       "feature": "lbl-feat", "needs-triage": "lbl-nt"},
            "project_id": "proj-1",
            "milestones": {"alpha": "ms-alpha", "v1": "ms-v1", "v2": "ms-v2"},
        }
        server.linear_open_triage_titles = lambda: [
            {"identifier": "GAL-31", "title": "Fix cluster popup overflow"}
        ]

        def fake_upload(data, mimetype, filename):
            self.uploaded.append({"data": data, "mimetype": mimetype, "filename": filename})
            return "https://uploads.linear.app/asset-1"
        server.linear_upload_image = fake_upload

        def fake_create(title, description, team_id, state_id, label_ids,
                        priority=None, project_id=None, milestone_id=None):
            self.created.append({
                "title": title, "description": description, "team_id": team_id,
                "state_id": state_id, "label_ids": label_ids,
                "priority": priority, "project_id": project_id, "milestone_id": milestone_id,
            })
            return {"identifier": "GAL-57", "url": "https://linear.app/gal/issue/GAL-57", "id": "iss-1"}
        server.linear_create_issue = fake_create

        server.anthropic_triage_firstpass = lambda desc, issues: {
            "title": "Fix map pins vanishing on rotation", "type_label": "Bug", "duplicate_of": None,
        }

    def tearDown(self) -> None:
        for name, val in self._seam_orig.items():
            setattr(server, name, val)
        server._REPORT_TRIAGE_CACHE = None
        super().tearDown()

    def test_unauthorized(self) -> None:
        status, _ = self.request("POST", "/api/report-issue", body={"description": "x"})
        self.assertEqual(status, 401)

    def test_missing_description(self) -> None:
        status, data = self.request("POST", "/api/report-issue", token=self.TOKEN, body={})
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")
        status, _ = self.request("POST", "/api/report-issue", token=self.TOKEN, body={"description": "   "})
        self.assertEqual(status, 400)

    def test_unconfigured_returns_503_and_config_hides_button(self) -> None:
        server.LINEAR_API_KEY = ""
        status, data = self.request("POST", "/api/report-issue", token=self.TOKEN, body={"description": "hi"})
        self.assertEqual(status, 503)
        self.assertEqual(data["error"], "report_unconfigured")
        # /api/config advertises the feature off and leaks neither key.
        status, cfg = self.request("GET", "/api/config")
        self.assertEqual(status, 200)
        self.assertFalse(cfg["report_enabled"])
        blob = json.dumps(cfg)
        self.assertNotIn("sk-ant", blob)
        self.assertNotIn("lin_api", blob)

    def test_happy_path_uses_ai_title_and_label(self) -> None:
        ctx = {
            "person_id": 2, "person_name": "Katie", "listing_id": "POC-2",
            "listing_address": "123 Example St", "view": "map", "source": "poc",
            "filters": "minPrice=500000&maxBeds=4", "deploy_token": "20260709-012811",
            "viewport": {"lat": 44.01, "lng": -79.45, "zoom": 11.2, "bearing": 0},
        }
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "Pins vanish on rotation", "context": ctx},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["identifier"], "GAL-57")
        self.assertTrue(data["ai_triage"])
        self.assertEqual(data["label"], "Bug")
        c = self.created[0]
        self.assertEqual(c["title"], "Fix map pins vanishing on rotation")
        self.assertEqual(c["label_ids"], ["lbl-bug"])
        self.assertEqual(c["state_id"], "state-1")
        for needle in ("Pins vanish on rotation", "Katie", "POC-2",
                       "minPrice=500000&maxBeds=4", "20260709-012811"):
            self.assertIn(needle, c["description"])
        # No selectors chosen: no priority, no milestone.
        self.assertIsNone(c["priority"])
        self.assertIsNone(c["milestone_id"])

    def test_tester_selectors_override_ai(self) -> None:
        # Tester picks type/priority/milestone; these win over the AI guess.
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "New idea for a saved-search alert",
                  "issue_type": "new", "priority": "high", "milestone": "V1"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["label"], "Feature")     # "new" -> Feature, not the AI's "Bug"
        self.assertEqual(data["priority"], 2)          # high -> 2
        self.assertEqual(data["milestone"], "V1")
        c = self.created[0]
        self.assertEqual(c["label_ids"], ["lbl-feat"])
        self.assertEqual(c["priority"], 2)
        self.assertEqual(c["project_id"], "proj-1")    # milestone forces the project
        self.assertEqual(c["milestone_id"], "ms-v1")

    def test_extension_maps_to_improvement(self) -> None:
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "extend the filter panel", "issue_type": "extension", "priority": "urgent"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["label"], "Improvement")
        self.assertEqual(data["priority"], 1)
        self.assertEqual(self.created[0]["label_ids"], ["lbl-imp"])

    def test_unknown_selectors_ignored(self) -> None:
        # Garbage selector values fall back to AI/no-op, never error.
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "x", "issue_type": "banana", "priority": "meh", "milestone": "V9"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["label"], "Bug")   # falls back to the AI label
        self.assertIsNone(data["priority"])
        self.assertIsNone(data["milestone"])
        self.assertIsNone(self.created[0]["milestone_id"])

    def test_milestone_without_project_is_skipped(self) -> None:
        # If the project could not be resolved, a milestone choice is dropped
        # rather than erroring (the issue still files).
        server.linear_resolve_triage_context = lambda: {
            "team_id": "team-1", "triage_state_id": "state-1",
            "labels": {"bug": "lbl-bug", "improvement": "lbl-imp",
                       "feature": "lbl-feat", "needs-triage": "lbl-nt"},
            "project_id": None, "milestones": {},
        }
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "x", "milestone": "V1"},
        )
        self.assertEqual(status, 200)
        self.assertIsNone(data["milestone"])
        self.assertIsNone(self.created[0]["milestone_id"])
        self.assertIsNone(self.created[0]["project_id"])

    def test_ai_failure_falls_back(self) -> None:
        server.anthropic_triage_firstpass = lambda desc, issues: None
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "Something broke on the grid view"},
        )
        self.assertEqual(status, 200)
        self.assertFalse(data["ai_triage"])
        c = self.created[0]
        self.assertTrue(c["title"].startswith("Tester report: "))
        self.assertEqual(c["label_ids"], ["lbl-nt"])
        self.assertIn("AI triage was unavailable", c["description"])

    def test_duplicate_note_recorded(self) -> None:
        server.anthropic_triage_firstpass = lambda desc, issues: {
            "title": "Fix cluster popup overflow again", "type_label": "Bug", "duplicate_of": "GAL-31",
        }
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "cluster popup overflows"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["duplicate_of"], "GAL-31")
        self.assertIn("GAL-31", self.created[0]["description"])

    def test_image_included_and_embedded(self) -> None:
        img = base64.b64encode(b"hello-bytes").decode("ascii")
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "with image", "image_base64": img, "image_mimetype": "image/png"},
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["image_attached"])
        self.assertEqual(self.uploaded[0]["data"], b"hello-bytes")
        self.assertIn("https://uploads.linear.app/asset-1", self.created[0]["description"])

    def test_image_upload_failure_still_files(self) -> None:
        server.linear_upload_image = lambda data, mimetype, filename: None
        img = base64.b64encode(b"bytes").decode("ascii")
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "img fails", "image_base64": img, "image_mimetype": "image/png"},
        )
        self.assertEqual(status, 200)
        self.assertFalse(data["image_attached"])
        self.assertIn("Image upload failed", self.created[0]["description"])

    def test_bad_base64_rejected(self) -> None:
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "x", "image_base64": "!!!not base64!!!", "image_mimetype": "image/png"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data["error"], "invalid_request")

    def test_oversized_image_413(self) -> None:
        server.REPORT_IMAGE_MAX_BYTES = 4
        img = base64.b64encode(b"way too many bytes").decode("ascii")
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "big", "image_base64": img, "image_mimetype": "image/png"},
        )
        self.assertEqual(status, 413)
        self.assertEqual(data["error"], "image_too_large")

    def test_bad_mimetype_rejected(self) -> None:
        img = base64.b64encode(b"bytes").decode("ascii")
        status, data = self.request(
            "POST", "/api/report-issue", token=self.TOKEN,
            body={"description": "x", "image_base64": img, "image_mimetype": "application/pdf"},
        )
        self.assertEqual(status, 400)

    def test_no_network_when_unkeyed(self) -> None:
        # Mirrors test_mapbox_drive_returns_none_without_token: the low-level
        # helpers must not attempt a call when their key is blank. Restore the
        # real function first (setUp stubbed it out as a seam).
        server.anthropic_triage_firstpass = self._seam_orig["anthropic_triage_firstpass"]
        server.ANTHROPIC_API_KEY = ""
        self.assertIsNone(server.anthropic_triage_firstpass("desc", []))
        server.LINEAR_API_KEY = ""
        with self.assertRaises(RuntimeError):
            server.linear_graphql("query { viewer { id } }")


class RoleMigrationTests(unittest.TestCase):
    """The advisor -> realtor storage migration: rebuilds people, converts the
    role value and CHECK, and preserves every id and foreign reference."""

    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "old.db"
        self._orig = server.DB_PATH
        server.DB_PATH = self.db_path
        # Build a database on the OLD schema (CHECK allows 'advisor'), with
        # people and foreign-referencing rows in the other tables.
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('buyer', 'advisor')),
                buyer_group_id INTEGER,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE listing_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL REFERENCES people(id),
                listing_id TEXT NOT NULL, action_type TEXT NOT NULL,
                rating INTEGER, status TEXT, note TEXT, reason TEXT,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE poi_pins (id INTEGER PRIMARY KEY, type TEXT, label TEXT,
                lat REAL, lng REAL, created_by INTEGER REFERENCES people(id),
                created_at TEXT);
            CREATE TABLE person_thresholds (person_id INTEGER PRIMARY KEY REFERENCES people(id),
                travel_minutes INTEGER, travel_total_minutes INTEGER, travel_mode TEXT,
                travel_dest_kind TEXT, travel_dest_ref TEXT, highway_km REAL,
                updated_by INTEGER, updated_at TEXT);
            CREATE TABLE potential_purchase_prices (listing_id TEXT PRIMARY KEY, price REAL,
                updated_by INTEGER REFERENCES people(id), updated_at TEXT);
            INSERT INTO people (id, name, role) VALUES
                (1,'Mark','buyer'), (2,'Katie','buyer'), (3,'Anees','advisor'), (4,'Kevin','advisor');
            INSERT INTO listing_feedback (person_id, listing_id, action_type, rating)
                VALUES (3, 'POC-2', 'rating', 5);
            INSERT INTO poi_pins (id, type, label, lat, lng, created_by) VALUES (1,'work','x',43.6,-79.4,4);
            """
        )
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        server.DB_PATH = self._orig
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_migration_converts_role_preserves_ids_and_refs(self) -> None:
        conn = server.get_db()
        try:
            result = server.migrate_role_advisor_to_realtor(conn)
            conn.commit()
            self.assertIsNotNone(result)
            # Counts unchanged; ids preserved; advisors became realtors.
            self.assertEqual(result["before"]["people_total"], result["after"]["people_total"])
            self.assertEqual(result["before"]["people_ids"], result["after"]["people_ids"])
            self.assertEqual(result["before"]["roles"], {"buyer": 2, "advisor": 2})
            self.assertEqual(result["after"]["roles"], {"buyer": 2, "realtor": 2})
            # No advisor token left; CHECK now allows realtor.
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM people WHERE role='advisor'").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM people WHERE role='realtor'").fetchone()[0], 2)
            schema = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='people'"
            ).fetchone()[0]
            self.assertIn("'realtor'", schema)
            self.assertNotIn("'advisor'", schema)
            # Foreign references still resolve to the same people ids.
            fb = conn.execute("SELECT person_id FROM listing_feedback WHERE listing_id='POC-2'").fetchone()[0]
            self.assertEqual(fb, 3)
            self.assertEqual(conn.execute("SELECT name FROM people WHERE id=3").fetchone()[0], "Anees")
            poi_owner = conn.execute("SELECT created_by FROM poi_pins WHERE id=1").fetchone()[0]
            self.assertEqual(poi_owner, 4)
        finally:
            conn.close()

    def test_migration_idempotent_second_run_is_noop(self) -> None:
        conn = server.get_db()
        try:
            self.assertIsNotNone(server.migrate_role_advisor_to_realtor(conn))
            conn.commit()
            self.assertIsNone(server.migrate_role_advisor_to_realtor(conn))
        finally:
            conn.close()


class HighwayHouseholdMigrationTests(unittest.TestCase):
    """Moving highway_km from person_thresholds to household_settings: copies
    a representative per-person value into the household setting, then drops
    the column."""

    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "hwy.db"
        self._orig = server.DB_PATH
        server.DB_PATH = self.db_path
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE household_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
                updated_by INTEGER, updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            CREATE TABLE person_thresholds (person_id INTEGER PRIMARY KEY,
                travel_minutes INTEGER, travel_total_minutes INTEGER, travel_mode TEXT,
                travel_dest_kind TEXT, travel_dest_ref TEXT, highway_km REAL,
                updated_by INTEGER, updated_at TEXT);
            INSERT INTO person_thresholds (person_id, travel_minutes, highway_km) VALUES (1, 20, 5.0), (2, 20, 5.0);
            """
        )
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        server.DB_PATH = self._orig
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_migration_copies_value_and_drops_column(self) -> None:
        conn = server.get_db()
        try:
            result = server.migrate_highway_km_to_household(conn)
            conn.commit()
            self.assertEqual(result["migrated_value"], "5")
            # household setting now holds it
            hv = conn.execute("SELECT value FROM household_settings WHERE key='highway_km'").fetchone()[0]
            self.assertEqual(hv, "5")
            # column is gone from person_thresholds
            cols = [r[1] for r in conn.execute("PRAGMA table_info(person_thresholds)").fetchall()]
            self.assertNotIn("highway_km", cols)
            # travel data preserved
            self.assertEqual(conn.execute("SELECT travel_minutes FROM person_thresholds WHERE person_id=1").fetchone()[0], 20)
            # idempotent
            self.assertIsNone(server.migrate_highway_km_to_household(conn))
        finally:
            conn.close()

    def test_migration_does_not_clobber_existing_household_value(self) -> None:
        conn = server.get_db()
        try:
            conn.execute("INSERT INTO household_settings (key, value) VALUES ('highway_km', '7')")
            conn.commit()
            result = server.migrate_highway_km_to_household(conn)
            conn.commit()
            self.assertIsNone(result["migrated_value"])  # did not overwrite
            hv = conn.execute("SELECT value FROM household_settings WHERE key='highway_km'").fetchone()[0]
            self.assertEqual(hv, "7")
            cols = [r[1] for r in conn.execute("PRAGMA table_info(person_thresholds)").fetchall()]
            self.assertNotIn("highway_km", cols)
        finally:
            conn.close()


class HighwayDistanceTests(unittest.TestCase):
    """Straight-line (crow-flies) distance from a listing to the nearest
    400-series highway. Pure functions plus the module-level HIGHWAY_LINES
    cache, no DB or server needed."""

    def setUp(self) -> None:
        self._saved_lines = server.HIGHWAY_LINES
        server.nearest_highway_km.cache_clear()

    def tearDown(self) -> None:
        server.HIGHWAY_LINES = self._saved_lines
        server.nearest_highway_km.cache_clear()

    def test_point_on_segment_is_zero(self) -> None:
        # P sits on a horizontal segment (same latitude, lon in range).
        km = server._point_to_segment_km(43.65, -79.38, 43.65, -79.40, 43.65, -79.30)
        self.assertAlmostEqual(km, 0.0, places=3)

    def test_perpendicular_offset_matches_latitude_delta(self) -> None:
        # 0.05 deg of latitude north of a horizontal segment is ~5.56 km.
        km = server._point_to_segment_km(43.70, -79.38, 43.65, -79.40, 43.65, -79.30)
        self.assertAlmostEqual(km, 5.56, delta=0.05)

    def test_beyond_segment_end_uses_endpoint(self) -> None:
        # P is west of both endpoints, so the nearest point is endpoint A,
        # not a perpendicular foot on the infinite line.
        km = server._point_to_segment_km(43.65, -79.50, 43.65, -79.40, 43.65, -79.30)
        # ~0.10 deg lon at 43.65 deg lat ~= 8.05 km.
        self.assertAlmostEqual(km, 8.05, delta=0.1)

    def test_nearest_highway_none_without_coords_or_data(self) -> None:
        server.HIGHWAY_LINES = [("Hwy TEST", [(43.65, -79.40), (43.65, -79.30)])]
        server.nearest_highway_km.cache_clear()
        self.assertEqual(server.nearest_highway_km(None, -79.38), (None, None))
        server.HIGHWAY_LINES = []
        server.nearest_highway_km.cache_clear()
        self.assertEqual(server.nearest_highway_km(43.65, -79.38), (None, None))

    def test_nearest_highway_picks_closest_line_and_label(self) -> None:
        server.HIGHWAY_LINES = [
            ("Hwy FAR", [(44.10, -79.40), (44.10, -79.30)]),
            ("Hwy NEAR", [(43.66, -79.40), (43.66, -79.30)]),
        ]
        server.nearest_highway_km.cache_clear()
        km, label = server.nearest_highway_km(43.65, -79.38)
        self.assertEqual(label, "Hwy NEAR")
        self.assertLess(km, 1.5)  # ~0.01 deg lat ~= 1.1 km

    def test_load_highways_reads_real_layers(self) -> None:
        # The committed layer files must load and yield a plausible distance
        # for a point sitting right on Highway 401 near Toronto.
        server.load_highways()
        self.assertTrue(server.HIGHWAY_LINES)
        labels = {label for label, _ in server.HIGHWAY_LINES}
        # Numeric refs read "Hwy N"; the QEW keeps its name (non-numeric stem).
        for expected in ("Hwy 400", "Hwy 401", "Hwy 403", "Hwy 404", "Hwy 407",
                         "Hwy 410", "Hwy 427", "Hwy 413", "QEW"):
            self.assertIn(expected, labels)
        km, label = server.nearest_highway_km(43.7663, -79.3522)  # a 401 vertex
        self.assertIsNotNone(km)
        self.assertLess(km, 1.0)


class ExportTests(unittest.TestCase):
    """Export is highly testable, so assert on the actual generated bytes."""

    COLUMNS = [
        {"key": "address", "label": "Address", "type": "text"},
        {"key": "price", "label": "Price", "type": "number"},
    ]
    ROWS = [
        {"address": "1096 Sunnidale Rd, Springwater", "price": 1320000},
        {"address": "26 Edgecombe Terr", "price": 1400000},
        {"address": "No price", "price": None},
    ]

    def test_csv_contents(self) -> None:
        out = server.build_csv(self.COLUMNS, self.ROWS).decode("utf-8-sig")
        lines = out.splitlines()
        self.assertEqual(lines[0], "Address,Price")
        self.assertIn('"1096 Sunnidale Rd, Springwater"', out)  # comma-containing value quoted
        self.assertIn("1320000", out)
        self.assertTrue(lines[3].endswith(","))  # None -> empty trailing field

    def test_xlsx_valid_zip_with_typed_cells(self) -> None:
        import io as _io
        import zipfile as _zipfile
        blob = server.build_xlsx(self.COLUMNS, self.ROWS)
        zf = _zipfile.ZipFile(_io.BytesIO(blob))  # raises if not a valid zip
        self.assertIn("xl/worksheets/sheet1.xml", zf.namelist())
        self.assertIn("[Content_Types].xml", zf.namelist())
        sheet = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
        self.assertIn('<t xml:space="preserve">Address</t>', sheet)  # header string
        self.assertIn("<v>1320000</v>", sheet)                        # number cell numeric
        self.assertIn("Springwater", sheet)                           # text cell present
        self.assertNotIn('<t xml:space="preserve">1320000</t>', sheet)  # number NOT stringified

    def test_handle_export_rejects_bad_format(self) -> None:
        _, _, _, status = server.handle_export({"format": "pdf", "columns": self.COLUMNS, "rows": self.ROWS})
        self.assertEqual(status, 400)

    def test_handle_export_filename_sanitized(self) -> None:
        _, _, fname, status = server.handle_export(
            {"format": "csv", "columns": self.COLUMNS, "rows": self.ROWS, "filename": "listings 2026/07/07 *active*"})
        self.assertEqual(status, 200)
        self.assertTrue(fname.endswith(".csv"))
        for bad in ("/", "*", " "):
            self.assertNotIn(bad, fname)


class ColumnPermissionTests(ServerTestCase):
    """The buying-party column-permission model: admin seeding/transfer,
    per-member group grants, and server-side enforcement on the grid payload,
    the feedback endpoint, and export."""

    def person_id(self, name: str) -> int:
        conn = server.get_db()
        try:
            return conn.execute("SELECT id FROM people WHERE name = ?", (name,)).fetchone()["id"]
        finally:
            conn.close()

    def deny(self, actor: int, person: int, group: str):
        return self.request("POST", "/api/column-permissions", token=self.TOKEN,
                            body={"actor_id": actor, "person_id": person, "group_key": group, "permitted": False})

    # ── admin seeding / transfer ──────────────────────────────────────────────
    def test_mark_is_seeded_admin_exactly_one(self) -> None:
        conn = server.get_db()
        try:
            admins = conn.execute("SELECT name FROM people WHERE is_admin = 1").fetchall()
        finally:
            conn.close()
        self.assertEqual([a["name"] for a in admins], ["Mark"])

    def test_get_column_permissions_defaults_all_true(self) -> None:
        status, data = self.request("GET", "/api/column-permissions", token=self.TOKEN)
        self.assertEqual(status, 200)
        self.assertEqual(data["admin_id"], self.person_id("Mark"))
        self.assertEqual({g["key"] for g in data["groups"]},
                         {"identity", "facts", "opinions", "financial", "location"})
        katie = str(self.person_id("Katie"))
        self.assertTrue(all(data["permissions"][katie].values()))

    def test_transfer_admin_moves_flag_and_keeps_exactly_one(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        status, data = self.request("POST", "/api/transfer-admin", token=self.TOKEN,
                                    body={"actor_id": mark, "new_admin_id": katie})
        self.assertEqual(status, 200)
        self.assertEqual(data["admin_id"], katie)
        conn = server.get_db()
        try:
            admins = [r["id"] for r in conn.execute("SELECT id FROM people WHERE is_admin = 1").fetchall()]
        finally:
            conn.close()
        self.assertEqual(admins, [katie])

    def test_non_admin_cannot_transfer(self) -> None:
        katie, mark = self.person_id("Katie"), self.person_id("Mark")
        status, data = self.request("POST", "/api/transfer-admin", token=self.TOKEN,
                                    body={"actor_id": katie, "new_admin_id": katie})
        self.assertEqual(status, 403)

    def test_cannot_transfer_admin_to_realtor(self) -> None:
        mark, anees = self.person_id("Mark"), self.person_id("Anees")
        status, _ = self.request("POST", "/api/transfer-admin", token=self.TOKEN,
                                 body={"actor_id": mark, "new_admin_id": anees})
        self.assertEqual(status, 400)

    # ── admin grants ──────────────────────────────────────────────────────────
    def test_non_admin_cannot_set_permission(self) -> None:
        katie = self.person_id("Katie")
        status, data = self.deny(katie, katie, "financial")
        self.assertEqual(status, 403)

    def test_admin_cannot_remove_own_financial(self) -> None:
        mark = self.person_id("Mark")
        status, data = self.deny(mark, mark, "financial")
        self.assertEqual(status, 403)

    def test_admin_can_remove_own_non_financial_group(self) -> None:
        mark = self.person_id("Mark")
        status, _ = self.deny(mark, mark, "location")
        self.assertEqual(status, 200)

    def test_deny_group_bad_key_400(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        status, _ = self.request("POST", "/api/column-permissions", token=self.TOKEN,
                                 body={"actor_id": mark, "person_id": katie, "group_key": "nope", "permitted": False})
        self.assertEqual(status, 400)

    # ── enforcement: grid payload ─────────────────────────────────────────────
    def test_financial_fields_present_by_default(self) -> None:
        katie = self.person_id("Katie")
        _, data = self.request("GET", f"/api/poc-listings?person_id={katie}")
        item = data["listings"][0]
        self.assertIn("price", item)
        self.assertIn("pit", item)

    def test_denied_financial_stripped_from_grid_payload(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        self.assertEqual(self.deny(mark, katie, "financial")[0], 200)
        _, data = self.request("GET", f"/api/poc-listings?person_id={katie}")
        for item in data["listings"]:
            for field in ("price", "pit", "pitNum", "dueClosing", "potentialPurchasePrice", "mortgageBreakdown"):
                self.assertNotIn(field, item)
            # Non-financial fields and the row id survive.
            self.assertIn("mls", item)
            self.assertIn("address", item)

    def test_denial_is_per_person_not_global(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        self.deny(mark, katie, "financial")
        _, kd = self.request("GET", f"/api/poc-listings?person_id={katie}")
        _, md = self.request("GET", f"/api/poc-listings?person_id={mark}")
        self.assertNotIn("price", kd["listings"][0])
        self.assertIn("price", md["listings"][0])  # Mark still sees it

    def test_no_person_id_all_permitted(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        self.deny(mark, katie, "financial")
        _, data = self.request("GET", "/api/poc-listings")  # no person_id
        self.assertIn("price", data["listings"][0])

    # ── enforcement: feedback (Opinions) ──────────────────────────────────────
    def test_denied_opinions_empties_feedback(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        # Baseline: Katie sees feedback.
        _, before = self.request("GET", f"/api/feedback?listing_ids=POC-2,POC-3&person_id={katie}", token=self.TOKEN)
        self.assertTrue(before["feedback"])
        self.assertEqual(self.deny(mark, katie, "opinions")[0], 200)
        _, after = self.request("GET", f"/api/feedback?listing_ids=POC-2,POC-3&person_id={katie}", token=self.TOKEN)
        self.assertEqual(after["feedback"], {})
        # Financial denial does not empty feedback (opinions still permitted).
        _, mk = self.request("GET", f"/api/feedback?listing_ids=POC-2,POC-3&person_id={mark}", token=self.TOKEN)
        self.assertTrue(mk["feedback"])

    # ── enforcement: export ───────────────────────────────────────────────────
    def test_export_drops_denied_financial_columns(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        self.deny(mark, katie, "financial")
        cols = [{"key": "address", "label": "Address", "type": "text"},
                {"key": "price", "label": "Price", "type": "number"}]
        rows = [{"address": "1 Test St", "price": 500000}]
        out, _, _, status = server.handle_export(
            {"format": "csv", "columns": cols, "rows": rows, "person_id": katie})
        self.assertEqual(status, 200)
        text = out.decode("utf-8-sig")
        self.assertIn("Address", text)
        self.assertNotIn("Price", text)   # header dropped
        self.assertNotIn("500000", text)  # value dropped

    def test_export_only_financial_columns_denied_403(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        self.deny(mark, katie, "financial")
        cols = [{"key": "price", "label": "Price", "type": "number"}]
        _, _, _, status = server.handle_export(
            {"format": "csv", "columns": cols, "rows": [{"price": 1}], "person_id": katie})
        self.assertEqual(status, 403)

    def test_export_permitted_person_keeps_financial(self) -> None:
        mark = self.person_id("Mark")
        cols = [{"key": "price", "label": "Price", "type": "number"}]
        out, _, _, status = server.handle_export(
            {"format": "csv", "columns": cols, "rows": [{"price": 500000}], "person_id": mark})
        self.assertEqual(status, 200)
        self.assertIn("500000", out.decode("utf-8-sig"))

    # ── personal grid prefs ───────────────────────────────────────────────────
    def test_grid_prefs_persist_and_return(self) -> None:
        katie = self.person_id("Katie")
        status, data = self.request("POST", "/api/grid-prefs", token=self.TOKEN,
                                    body={"person_id": katie, "hidden_columns": ["sqft", "commute"]})
        self.assertEqual(status, 200)
        _, cp = self.request("GET", "/api/column-permissions", token=self.TOKEN)
        self.assertEqual(sorted(cp["grid_prefs"][str(katie)]["hidden_columns"]), ["commute", "sqft"])

    def test_grid_prefs_drops_unknown_columns(self) -> None:
        katie = self.person_id("Katie")
        self.request("POST", "/api/grid-prefs", token=self.TOKEN,
                     body={"person_id": katie, "hidden_columns": ["sqft", "not_a_real_column"]})
        _, cp = self.request("GET", "/api/column-permissions", token=self.TOKEN)
        self.assertEqual(cp["grid_prefs"][str(katie)]["hidden_columns"], ["sqft"])

    def test_new_card_parity_columns_are_valid_grid_prefs(self) -> None:
        # Card-parity columns added to the picker must be accepted (not dropped
        # as unknown) when a member hides them.
        katie = self.person_id("Katie")
        new_cols = ["listPrice", "potentialPrice", "condoFees", "note",
                    "goStation", "goDrive", "goTrain", "highwayName", "attachments"]
        self.request("POST", "/api/grid-prefs", token=self.TOKEN,
                     body={"person_id": katie, "hidden_columns": new_cols})
        _, cp = self.request("GET", "/api/column-permissions", token=self.TOKEN)
        self.assertEqual(sorted(cp["grid_prefs"][str(katie)]["hidden_columns"]), sorted(new_cols))

    def test_group_column_lists_include_new_columns(self) -> None:
        _, data = self.request("GET", "/api/column-permissions", token=self.TOKEN)
        by_key = {g["key"]: g["columns"] for g in data["groups"]}
        self.assertIn("listPrice", by_key["financial"])
        self.assertIn("potentialPrice", by_key["financial"])
        self.assertIn("condoFees", by_key["financial"])
        self.assertIn("note", by_key["opinions"])
        self.assertIn("goStation", by_key["location"])
        self.assertIn("highwayName", by_key["location"])

    def test_export_denied_financial_drops_condo_fees(self) -> None:
        mark, katie = self.person_id("Mark"), self.person_id("Katie")
        self.deny(mark, katie, "financial")
        cols = [{"key": "address", "label": "Address", "type": "text"},
                {"key": "condoFees", "label": "Condo fees", "type": "number"}]
        out, _, _, status = server.handle_export(
            {"format": "csv", "columns": cols, "rows": [{"address": "x", "condoFees": 400}], "person_id": katie})
        self.assertEqual(status, 200)
        text = out.decode("utf-8-sig")
        self.assertNotIn("Condo fees", text)
        self.assertNotIn("400", text)

    def test_grid_prefs_do_not_strip_payload(self) -> None:
        # Personal hiding is a view preference, not a permission: the payload is
        # unaffected (the data is still permitted to reach the person).
        katie = self.person_id("Katie")
        self.request("POST", "/api/grid-prefs", token=self.TOKEN,
                     body={"person_id": katie, "hidden_columns": ["price"]})
        _, data = self.request("GET", f"/api/poc-listings?person_id={katie}")
        self.assertIn("price", data["listings"][0])


if __name__ == "__main__":
    unittest.main()
