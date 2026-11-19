#!/usr/bin/env python3
"""Pins the feature switches the web smoke test expects (e2e/e2e-flags.json) and restores the previous
values afterwards, so toggling switches in the admin app never breaks E2E and E2E never leaves the
owner's settings changed.

Usage: python3 scripts/ci/e2e-flags.py pin|restore
Env:   SUPABASE_ACCESS_TOKEN, PROJECT_REF, optional SUPABASE_MGMT_URL (local stand-in for e2e-local),
       E2E_FLAGS_STATE (snapshot file, default e2e-flags-before.json).
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("SUPABASE_MGMT_URL", "https://api.supabase.com")
STATE = os.environ.get("E2E_FLAGS_STATE", "e2e-flags-before.json")


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


def main(mode):
    if mode == "pin":
        rows = query("select coalesce(json_object_agg(key, enabled), '{}'::json) as flags from public.feature_flags")
        before = rows[0]["flags"] if rows else {}
        with open(STATE, "w") as f:
            json.dump(before, f)
        want = wanted()
        changed = {k: v for k, v in want.items() if k in before and before[k] != v}
        missing = sorted(k for k in want if k not in before)
        apply(want)
        print(f"e2e-flags: pinned {len(want)} switches; changed for this run: {json.dumps(changed)}")
        if missing:
            print(f"e2e-flags: not in this database yet (ignored): {', '.join(missing)}")
    elif mode == "restore":
        if not os.path.exists(STATE):
            print("e2e-flags: no snapshot; nothing to restore")
            return
        with open(STATE) as f:
            before = json.load(f)
        # Restore only switches this run pinned, so other switches edited during the run are kept.
        apply({k: before[k] for k in wanted() if k in before})
        print("e2e-flags: restored the previous values")
    else:
        sys.exit("usage: e2e-flags.py pin|restore")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
