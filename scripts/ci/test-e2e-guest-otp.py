#!/usr/bin/env python3
"""Verify guest OTP preparation accepts equivalent Auth expiry timestamp formats."""
import importlib.util
import json
import os
import tempfile
from pathlib import Path


HELPER = Path(__file__).with_name("e2e-guest-otp.py")
ORIGINAL_CONFIG = {
    "sms_test_otp": "919999999999=123456",
    "sms_test_otp_valid_until": "2099-12-31T23:59:59Z",
}


def load_helper(state_path):
    os.environ.update({
        "DEMO_PROJECT": "1",
        "GUEST_E2E_PHONE": "9000000999",
        "GUEST_OTP_STATE": str(state_path),
    })
    spec = importlib.util.spec_from_file_location("guest_otp_helper", HELPER)
    if spec is None or spec.loader is None:
        raise AssertionError("Could not load guest OTP helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_expiry_parser_normalizes_equivalent_timestamps():
    with tempfile.TemporaryDirectory() as temp_dir:
        helper = load_helper(Path(temp_dir) / "snapshot.json")
        utc_z = helper.parse_auth_expiry("2030-01-02T03:04:05Z")
        utc_offset = helper.parse_auth_expiry("2030-01-02T03:04:05.000+00:00")
        other_offset = helper.parse_auth_expiry("2030-01-02T05:04:05+02:00")
        assert utc_z is not None
        assert utc_z == utc_offset == other_offset
        assert helper.parse_auth_expiry("2030-01-02T03:04:05") is None
        assert helper.parse_auth_expiry("not-a-timestamp") is None


def test_prepare_accepts_normalized_expiry_readback():
    with tempfile.TemporaryDirectory() as temp_dir:
        helper = load_helper(Path(temp_dir) / "snapshot.json")
        current_config = ORIGINAL_CONFIG.copy()

        def request_json(method, path, body=None):
            if method == "GET":
                return current_config.copy()
            current_config.update(body)
            expiry = current_config["sms_test_otp_valid_until"]
            current_config["sms_test_otp_valid_until"] = expiry.replace("Z", "+00:00")
            return {}

        helper.request_json = request_json
        helper.reset_test_user = lambda: None
        helper.prepare()
        entries = [entry.strip() for entry in current_config["sms_test_otp"].split(",") if entry.strip()]
        guest_mapping_configured = any(
            helper.normalized_role_phone(entry.partition("=")[0]) == "919000000999"
            and entry.partition("=")[2].strip() == helper.TEST_OTP
            for entry in entries
        )
        assert guest_mapping_configured, json.dumps({
            "guest_mapping_configured": guest_mapping_configured,
            "entry_count": len(entries),
        }, sort_keys=True)


if __name__ == "__main__":
    test_expiry_parser_normalizes_equivalent_timestamps()
    test_prepare_accepts_normalized_expiry_readback()
    print("guest-otp: expiry normalization tests passed")
