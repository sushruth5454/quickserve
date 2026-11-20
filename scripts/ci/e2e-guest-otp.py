#!/usr/bin/env python3
"""Temporarily prepare and restore the DEMO-only guest E2E test account and OTP mapping."""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_BASE = os.environ.get("SUPABASE_MGMT_URL", "https://api.supabase.com")
STATE = Path(os.environ.get(
    "GUEST_OTP_STATE",
    str(Path(os.environ.get("RUNNER_TEMP", ".")) / "guest-otp-snapshot.json"),
))
TEST_OTP = "123456"


def fail(message):
    sys.exit(f"guest-otp: {message}")


def environment():
    if os.environ.get("DEMO_PROJECT") != "1":
        fail("refusing to change Auth settings unless DEMO_PROJECT=1")
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    project = os.environ.get("PROJECT_REF")
    raw_phone = os.environ.get("GUEST_E2E_PHONE", "")
    if not token or not project or not raw_phone:
        fail("SUPABASE_ACCESS_TOKEN, PROJECT_REF, and GUEST_E2E_PHONE are required")
    raw_phone = raw_phone.strip()
    if not re.fullmatch(r"\+?[0-9\s()-]+", raw_phone):
        fail("GUEST_E2E_PHONE must contain only a phone number and common separators")
    digits = re.sub(r"[\s()-]", "", raw_phone)
    if digits.startswith("+"):
        digits = digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    if not re.fullmatch(r"91[6-9]\d{9}", digits):
        fail("GUEST_E2E_PHONE must be a 10-digit Indian mobile or 91-prefixed test number")
    return token, project, digits


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def normalized_role_phone(raw_phone):
    digits = re.sub(r"\D", "", raw_phone or "")
    if len(digits) == 10:
        return "91" + digits
    if re.fullmatch(r"91[6-9]\d{9}", digits):
        return digits
    return None


def ensure_guest_phone_is_distinct(guest_phone):
    roles = {
        "E2E_CUSTOMER_PHONE": os.environ.get("E2E_CUSTOMER_PHONE", "9999999999"),
        "NEW_PRO_PHONE": os.environ.get("NEW_PRO_PHONE", "9000000301"),
        "ADMIN_E2E_PHONE": os.environ.get("ADMIN_E2E_PHONE", ""),
        "RAVI_SIGN_IN": "+919000000101",
    }
    collisions = sorted(
        role for role, value in roles.items()
        if normalized_role_phone(value) == guest_phone
    )
    if collisions:
        fail(f"GUEST_E2E_PHONE must be distinct from other OTP roles: {', '.join(collisions)}")


def request_json(method, path, body=None):
    token, project, _ = environment()
    payload = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        f"{API_BASE}/v1/projects/{project}/{path}",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "quickserve-e2e-guest-otp",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = response.read().decode()
    except urllib.error.HTTPError as error:
        fail(f"{method} {path} failed (HTTP {error.code})")
    return json.loads(result) if result.strip() else {}


def database_query(sql):
    token, project, _ = environment()
    request = urllib.request.Request(
        f"{API_BASE}/v1/projects/{project}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "quickserve-e2e-guest-otp",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = response.read().decode()
    except urllib.error.HTTPError as error:
        fail(f"guest test-account query failed (HTTP {error.code})")
    return json.loads(result) if result.strip() else []


def reset_test_user():
    _, _, phone = environment()
    phone_literals = f"{sql_literal(phone)}, {sql_literal('+' + phone)}"
    rows = database_query(
        "select u.id, exists (select 1 from public.bookings b "
        "where b.customer_id = u.id or b.provider_id = u.id) as has_bookings, "
        "exists (select 1 from public.admins a where a.user_id = u.id) as is_admin "
        f"from auth.users u where u.phone in ({phone_literals})"
    )
    if not isinstance(rows, list):
        fail("guest test-account query returned an unexpected shape")
    if len(rows) > 1:
        fail("multiple guest test accounts match GUEST_E2E_PHONE")
    if not rows:
        return
    has_bookings = rows[0].get("has_bookings") is True or str(rows[0].get("has_bookings")).lower() == "true"
    is_admin = rows[0].get("is_admin") is True or str(rows[0].get("is_admin")).lower() == "true"
    if has_bookings or is_admin:
        fail("guest test account has bookings or admin membership; refusing to delete it")
    user_id = rows[0].get("id", "")
    if not re.fullmatch(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}", str(user_id)):
        fail("guest test-account query returned an invalid user id")
    database_query(f"delete from auth.users where id = {sql_literal(user_id)}")
    remaining = database_query(
        f"select count(*)::int as count from auth.users where phone in ({phone_literals})"
    )
    if not isinstance(remaining, list) or not remaining or int(remaining[0].get("count", -1)) != 0:
        fail("guest test account could not be reset")


def get_auth_config():
    config = request_json("GET", "config/auth")
    if not isinstance(config, dict) or not isinstance(config.get("sms_test_otp"), str):
        fail("Auth config does not contain a string sms_test_otp setting")
    if not isinstance(config.get("sms_test_otp_valid_until"), str) or not config["sms_test_otp_valid_until"]:
        fail("Auth config does not contain sms_test_otp_valid_until; refusing temporary OTP changes")
    return config


def prepare():
    _, _, phone = environment()
    ensure_guest_phone_is_distinct(phone)
    if STATE.exists():
        fail("guest OTP snapshot already exists")
    config = get_auth_config()
    state = {
        "sms_test_otp": config["sms_test_otp"],
        "sms_test_otp_valid_until": config["sms_test_otp_valid_until"],
    }

    entries = [entry.strip() for entry in config["sms_test_otp"].split(",") if entry.strip()]
    updated = []
    found = False
    for entry in entries:
        entry_phone, separator, code = entry.partition("=")
        if not separator:
            fail("Auth sms_test_otp contains a malformed entry")
        entry_digits = re.sub(r"\D", "", entry_phone)
        if entry_digits == phone:
            found = True
            updated.append(f"{phone}={TEST_OTP}")
        else:
            updated.append(entry)
    if not found:
        updated.append(f"{phone}={TEST_OTP}")
    new_value = ",".join(updated)
    temporary_valid_until = (
        (datetime.now(timezone.utc) + timedelta(hours=2))
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    STATE.write_text(json.dumps(state), encoding="utf-8")
    reset_test_user()
    request_json("PATCH", "config/auth", {
        "sms_test_otp": new_value,
        "sms_test_otp_valid_until": temporary_valid_until,
    })
    current = get_auth_config()
    configured = any(
        re.sub(r"\D", "", entry.partition("=")[0]) == phone
        and entry.partition("=")[2].strip() == TEST_OTP
        for entry in current["sms_test_otp"].split(",")
    )
    if not configured or current["sms_test_otp_valid_until"] != temporary_valid_until:
        request_json("PATCH", "config/auth", state)
        fail("temporary guest OTP mapping or expiry was not persisted; original settings restored")
    print("guest-otp: DEMO test account reset and temporary SMS test OTP enabled")


def restore():
    if not STATE.exists():
        fail("guest OTP snapshot is missing; cannot restore Auth settings")
    state = json.loads(STATE.read_text(encoding="utf-8"))
    if not isinstance(state, dict) or not isinstance(state.get("sms_test_otp"), str):
        fail("guest OTP snapshot has an unexpected shape")
    request_json("PATCH", "config/auth", state)
    print("guest-otp: original SMS test OTP settings restored")


def verify():
    if not STATE.exists():
        fail("guest OTP snapshot is missing; cannot verify restoration")
    state = json.loads(STATE.read_text(encoding="utf-8"))
    current = get_auth_config()
    keys = ("sms_test_otp", "sms_test_otp_valid_until")
    if any(current.get(key) != state.get(key) for key in keys if key in state):
        fail("restored SMS test OTP settings differ from the original snapshot")
    print("guest-otp: SMS test OTP settings match the original snapshot")


def cleanup():
    reset_test_user()
    print("guest-otp: test account cleanup complete")


def main(mode):
    commands = {"prepare": prepare, "restore": restore, "verify": verify, "cleanup": cleanup}
    action = commands.get(mode)
    if action is None:
        fail("usage: e2e-guest-otp.py prepare|restore|verify|cleanup")
    action()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
