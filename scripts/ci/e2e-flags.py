#!/usr/bin/env python3
"""Pins the feature switches the web smoke test expects (e2e/e2e-flags.json) and restores the previous
values afterwards, so toggling switches in the admin app never breaks E2E and E2E never leaves the
owner's settings changed.

Usage: python3 scripts/ci/e2e-flags.py pin|legacy-off|redesign-on|restore|verify
Env:   SUPABASE_ACCESS_TOKEN, PROJECT_REF, optional SUPABASE_MGMT_URL (local stand-in for e2e-local),
       E2E_FLAGS_STATE (snapshot file, default e2e-flags-before.json).
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("SUPABASE_MGMT_URL", "https://api.supabase.com")
STATE = os.environ.get("E2E_FLAGS_STATE", "e2e-flags-before.json")
REDESIGN_FLAGS = (
    "home_v2",
    "unified_search",
    "guest_browse",
    "creators_landing",
    "booking_steps",
    "book_again",
)
PRIVATE_OORVA_FLAGS = ("oorva_brand", "oorva_admin_ops_ux")
PINNED_FLAGS = REDESIGN_FLAGS + PRIVATE_OORVA_FLAGS


def query(sql):
    req = urllib.request.Request(
        f"{BASE}/v1/projects/{os.environ['PROJECT_REF']}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
            "Content-Type": "application/json",
            "User-Agent": "quickserve-e2e-flags",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode()
    return json.loads(body) if body.strip() else []


def wanted():
    with open("e2e/e2e-flags.json") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def apply(values):
    payload = json.dumps(values)
    assert "$flags$" not in payload
    query(
        "update public.feature_flags f set enabled = v.value::boolean, updated_at = now() "
        f"from json_each_text($flags${payload}$flags$::json) v "
        "where f.key = v.key and f.enabled is distinct from v.value::boolean"
    )


def read_flags(keys):
    keys = tuple(keys)
    sql_keys = ", ".join(f"'{key}'" for key in keys)
    rows = query(f"select key, enabled from public.feature_flags where key in ({sql_keys})")
    if not isinstance(rows, list):
        sys.exit("e2e-flags: feature flag query returned an unexpected shape")
    values = {row["key"]: row["enabled"] for row in rows if isinstance(row, dict) and "key" in row}
    missing = sorted(set(keys) - set(values))
    if missing:
        sys.exit(f"e2e-flags: required switches missing from this database: {', '.join(missing)}")
    return values


def set_redesign_flags(enabled):
    expected = {key: enabled for key in REDESIGN_FLAGS}
    private_local_stack = (
        os.environ.get("PROJECT_REF") == "local"
        and BASE.rstrip("/") == "http://127.0.0.1:54399"
    )
    expected.update({key: enabled if private_local_stack else False for key in PRIVATE_OORVA_FLAGS})
    read_flags(expected)
    apply(expected)
    actual = read_flags(expected)
    if actual != expected:
        sys.exit(f"e2e-flags: redesign switch update did not persist: {json.dumps(actual, sort_keys=True)}")
    state = "ON" if enabled else "OFF"
    print(f"e2e-flags: set {len(expected)} smoke switches {state}")


def main(mode):
    if mode == "pin":
        rows = query("select coalesce(json_object_agg(key, enabled), '{}'::json) as flags from public.feature_flags")
        before = rows[0]["flags"] if rows else {}
        with open(STATE, "w") as f:
            json.dump(before, f)
        if not isinstance(before, dict):
            sys.exit("e2e-flags: feature flag snapshot returned an unexpected shape")
        missing_required = sorted(set(PINNED_FLAGS) - set(before))
        if missing_required:
            sys.exit(f"e2e-flags: required switches missing from snapshot: {', '.join(missing_required)}")
        want = wanted()
        changed = {k: v for k, v in want.items() if k in before and before[k] != v}
        missing = sorted(k for k in want if k not in before)
        apply(want)
        print(f"e2e-flags: pinned {len(want)} switches; changed for this run: {json.dumps(changed)}")
        if missing:
            print(f"e2e-flags: not in this database yet (ignored): {', '.join(missing)}")
    elif mode == "legacy-off":
        set_redesign_flags(False)
    elif mode == "redesign-on":
        set_redesign_flags(True)
    elif mode == "restore":
        if not os.path.exists(STATE):
            sys.exit("e2e-flags: snapshot is missing; cannot restore owner values")
        with open(STATE) as f:
            before = json.load(f)
        if not isinstance(before, dict):
            sys.exit("e2e-flags: snapshot has an unexpected shape")
        missing_required = sorted(set(PINNED_FLAGS) - set(before))
        if missing_required:
            sys.exit(f"e2e-flags: snapshot is missing required switches: {', '.join(missing_required)}")
        # Restore only switches this run pinned, so other switches edited during the run are kept.
        apply({k: before[k] for k in wanted() if k in before})
        print("e2e-flags: restored the previous values")
    elif mode == "verify":
        if not os.path.exists(STATE):
            sys.exit("e2e-flags: snapshot is missing; cannot verify owner values")
        with open(STATE) as f:
            before = json.load(f)
        if not isinstance(before, dict):
            sys.exit("e2e-flags: snapshot has an unexpected shape")
        expected = {key: before[key] for key in PINNED_FLAGS if key in before}
        if len(expected) != len(PINNED_FLAGS):
            sys.exit("e2e-flags: snapshot is missing required redesign switches")
        actual = read_flags(PINNED_FLAGS)
        if actual != expected:
            sys.exit(
                "e2e-flags: restored switch values differ from snapshot: "
                f"expected={json.dumps(expected, sort_keys=True)} actual={json.dumps(actual, sort_keys=True)}"
            )
        print(f"e2e-flags: all {len(PINNED_FLAGS)} smoke switches match the original snapshot")
    else:
        sys.exit("usage: e2e-flags.py pin|legacy-off|redesign-on|restore|verify")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
