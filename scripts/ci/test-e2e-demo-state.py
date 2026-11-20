#!/usr/bin/env python3
"""Verify DEMO guards and reset safety without making network requests."""
import importlib.util
import json
import os
from pathlib import Path


SCRIPT = Path(__file__).with_name("e2e-demo-state.py")


def load_helper():
    os.environ.update({
        "SUPABASE_ACCESS_TOKEN": "local",
        "PROJECT_REF": "local",
        "SUPABASE_MGMT_URL": "http://127.0.0.1:54399",
    })
    spec = importlib.util.spec_from_file_location("e2e_demo_state", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError("Could not load E2E demo-state helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_demo_project_guard():
    helper = load_helper()
    os.environ["DEMO_PROJECT"] = "0"
    try:
        helper.environment()
    except SystemExit as error:
        assert "DEMO_PROJECT=1" in str(error), json.dumps({"error": str(error)})
    else:
        raise AssertionError("demo-state helper accepted a non-DEMO project")


def test_cleanup_rejects_unscoped_marker():
    helper = load_helper()
    os.environ["DEMO_PROJECT"] = "1"
    os.environ["QA_MARKER"] = "QA-E2E local 123-1'; drop table public.bookings"
    calls = []
    helper.database_query = lambda sql: calls.append(sql)
    try:
        helper.cleanup_qa_rows()
    except SystemExit as error:
        assert "workflow-generated E2E marker" in str(error), json.dumps({"error": str(error)})
    else:
        raise AssertionError("cleanup accepted an unscoped QA marker")
    assert not calls, json.dumps({"database_queries_sent": len(calls)})


def test_provider_reset_refuses_booked_user():
    helper = load_helper()
    os.environ["DEMO_PROJECT"] = "1"
    calls = []

    def database_query(sql):
        calls.append(sql)
        return [{"id": "11111111-1111-1111-1111-111111111111", "has_bookings": True, "is_admin": False}]

    helper.database_query = database_query
    try:
        helper.reset_fresh_provider()
    except SystemExit as error:
        assert "bookings or admin membership" in str(error), json.dumps({"error": str(error)})
    else:
        raise AssertionError("provider reset did not fail closed")
    assert len(calls) == 1 and calls[0].lstrip().lower().startswith("select"), json.dumps({
        "database_queries_sent": len(calls),
        "delete_attempted": any("delete" in sql.lower() for sql in calls),
    })


if __name__ == "__main__":
    test_demo_project_guard()
    test_cleanup_rejects_unscoped_marker()
    test_provider_reset_refuses_booked_user()
    print("e2e-demo-state: safety tests passed")
