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
            "markRank": "",
            "katieRank": 5,
            "markComments": "",
            "katieComments": "Love it",
            "rejBy": "Mark",
            "rejReason": "too small",
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
        self.assertEqual(mark["status"], "research_requested")

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


if __name__ == "__main__":
    unittest.main()
