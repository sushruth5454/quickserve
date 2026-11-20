#!/usr/bin/env python3
"""Reset seeded demo fixtures and remove rows created by a marked E2E pass."""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


API_BASE = os.environ.get("SUPABASE_MGMT_URL", "https://api.supabase.com")
FRESH_PROVIDER_PHONE = "919000000301"


def fail(message):
    sys.exit(f"e2e-demo-state: {message}")


def environment():
    if os.environ.get("DEMO_PROJECT") != "1":
        fail("refusing to modify demo data unless DEMO_PROJECT=1")
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    project = os.environ.get("PROJECT_REF")
    if not token or not project:
        fail("SUPABASE_ACCESS_TOKEN and PROJECT_REF are required")
    return token, project


def safe_error_details(body):
    try:
        response = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        response = {}
    if not isinstance(response, dict):
        response = {}
    safe = {key: response[key] for key in ("code", "message", "hint", "details") if key in response}
    details = json.dumps(safe, ensure_ascii=False)
    details = re.sub(r"\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b", "[REDACTED-GUID]", details, flags=re.I)
    return re.sub(r"(?<!\d)(?:\+?\d[\d\s()-]{6,}\d)(?!\d)", "[REDACTED-NUMBER]", details)


def database_query(sql):
    token, project = environment()
    returns_rows = sql.lstrip().lower().startswith(("select", "with"))
    request = urllib.request.Request(
        f"{API_BASE}/v1/projects/{project}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "quickserve-e2e-demo-state",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = response.read().decode()
            status = response.status
    except urllib.error.HTTPError as error:
        fail(f"demo-state query failed (HTTP {error.code}): {safe_error_details(error.read())}")
    if not 200 <= status < 300:
        fail(f"demo-state query failed (HTTP {status})")
    return json.loads(result) if returns_rows and result.strip() else []


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def reset_seeded_demo_data():
    seed_path = Path("supabase/seed-all-services.sql")
    if not seed_path.is_file():
        fail("supabase/seed-all-services.sql is missing")
    seed = seed_path.read_text(encoding="utf-8")
    transaction_start = "begin;\n\n"
    if seed.count(transaction_start) != 1:
        fail("seed-all-services.sql does not have the expected transaction header")
    sql = seed.replace(
        transaction_start,
        "begin;\nselect set_config('quickserve.demo_seed', '1', true);\n\n",
        1,
    )
    database_query(sql)
    print("e2e-demo-state: seeded DEMO fixtures reset")


def cleanup_qa_rows():
    marker = os.environ.get("QA_MARKER", "")
    if not re.fullmatch(r"QA-E2E (?:web-smoke|local) [0-9]+-[0-9]+", marker):
        fail("QA_MARKER must be a workflow-generated E2E marker")
    marker = marker.replace("'", "''")
    sql = f"""
    begin;
    create temp table qa_sports_bookings on commit drop as
      select id from public.sports_bookings
       where note like '{marker} sports booking%';
    create temp table qa_product_enquiry_messages on commit drop as
      select id, enquiry_id, created_at from public.product_enquiry_messages
       where body like '{marker} product enquiry%';
    create temp table qa_new_product_enquiries on commit drop as
      select e.id
        from public.product_enquiries e
        join (
          select enquiry_id, min(created_at) as created_at
            from qa_product_enquiry_messages
           group by enquiry_id
        ) m on m.enquiry_id = e.id and m.created_at = e.created_at;
    create temp table qa_rfqs on commit drop as
      select id from public.rfqs
       where title like '{marker}%' or notes like '{marker}%';
    create temp table qa_owner_shops on commit drop as
      select id from public.shops
       where name = '{marker} approval shop'
         and description = '{marker} synthetic owner submission and admin approval; no real sales.';
    create temp table qa_owner_shop_audit on commit drop as
      select id from public.admin_audit_log
         where target_id in (
           select s.id from public.shops s
            where s.id in (select id from qa_owner_shops)
              and not exists (select 1 from public.products p where p.shop_id = s.id)
              and not exists (select 1 from public.product_enquiries e where e.shop_id = s.id)
              and not exists (select 1 from public.rfq_recipients r where r.shop_id = s.id)
              and not exists (select 1 from public.supplier_quotes q where q.shop_id = s.id)
         )
         and action = 'set_shop_status'
         and details ->> 'status' = 'verified';
    create temp table qa_owner_shops_cleanup on commit drop as
      select s.id from public.shops s
         where s.id in (select id from qa_owner_shops)
           and not exists (select 1 from public.products p where p.shop_id = s.id)
           and not exists (select 1 from public.product_enquiries e where e.shop_id = s.id)
           and not exists (select 1 from public.rfq_recipients r where r.shop_id = s.id)
           and not exists (select 1 from public.supplier_quotes q where q.shop_id = s.id);
    create temp table qa_requests on commit drop as
      select id from public.service_requests where intake::text like '%{marker}%';
    create temp table qa_bookings on commit drop as
      select b.id from public.bookings b
       where b.service_request_id in (select id from qa_requests)
          or b.proposal_id in (select p.id from public.proposals p where p.note like '{marker}%')
          or b.description like '%{marker}%';
    delete from public.notifications n
     where n.data ->> 'sports_booking_id' in
             (select id::text from qa_sports_bookings)
        or n.data ->> 'rfq_id' in
             (select id::text from qa_rfqs)
        or (
             n.data ->> 'enquiry_id' in
               (select enquiry_id::text from qa_product_enquiry_messages)
             and n.body like '{marker} product enquiry%'
             and exists (
               select 1 from qa_product_enquiry_messages m
                where m.enquiry_id::text = n.data ->> 'enquiry_id'
                  and n.created_at >= m.created_at
             )
        );
    delete from public.payment_receipts where booking_id in (select id from qa_bookings);
    delete from public.bookings where id in (select id from qa_bookings);
    delete from public.service_requests where id in (select id from qa_requests);
    delete from public.messages where body like '{marker}%';
    delete from public.product_enquiry_messages
     where id in (select id from qa_product_enquiry_messages);
    delete from public.product_enquiries e
     where e.id in (select id from qa_new_product_enquiries)
       and not exists (
         select 1 from public.product_enquiry_messages m where m.enquiry_id = e.id
       );
    delete from public.rfqs where id in (select id from qa_rfqs);
    delete from public.sports_bookings where id in (select id from qa_sports_bookings);
    delete from public.admin_audit_log where id in (select id from qa_owner_shop_audit);
    delete from public.shops s
     where s.id in (select id from qa_owner_shops_cleanup);
    select
      (select count(*) from qa_bookings) as bookings_removed,
      (select count(*) from qa_requests) as requests_removed,
      (select count(*) from qa_sports_bookings) as sports_bookings_removed,
      (select count(*) from qa_product_enquiry_messages) as product_messages_removed,
      (select count(*) from qa_new_product_enquiries) as product_enquiries_considered,
      (select count(*) from qa_rfqs) as rfqs_removed,
      (select count(*) from qa_owner_shops) as owner_shops_matched,
      (select count(*) from qa_owner_shops_cleanup) as owner_shops_removed,
      (select count(*) from qa_owner_shop_audit) as owner_shop_audit_removed;
    commit;
    """
    database_query(sql)
    print("e2e-demo-state: QA-marked E2E rows cleaned")


def reset_fresh_provider():
    phone = sql_literal(FRESH_PROVIDER_PHONE)
    rows = database_query(
        "select u.id, "
        "exists (select 1 from public.bookings b where b.provider_id = u.id or b.customer_id = u.id) as has_bookings, "
        "exists (select 1 from public.admins a where a.user_id = u.id) as is_admin "
        f"from auth.users u where u.phone = {phone}"
    )
    if not isinstance(rows, list):
        fail("fresh-provider lookup returned an unexpected shape")
    if len(rows) > 1:
        fail("multiple fresh-provider test accounts matched; refusing to delete")
    if not rows:
        print("e2e-demo-state: fresh-provider test account already absent")
        return
    has_bookings = rows[0].get("has_bookings") is True or str(rows[0].get("has_bookings")).lower() == "true"
    is_admin = rows[0].get("is_admin") is True or str(rows[0].get("is_admin")).lower() == "true"
    if has_bookings or is_admin:
        fail("fresh-provider test account has bookings or admin membership; refusing to delete")
    user_id = rows[0].get("id", "")
    if not re.fullmatch(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}", str(user_id)):
        fail("fresh-provider lookup returned an invalid user id")
    database_query(f"delete from auth.users where id = {sql_literal(user_id)}")
    rows = database_query(
        f"select count(*)::int as count from auth.users where phone = {phone}"
    )
    if not isinstance(rows, list) or not rows or int(rows[0].get("count", -1)) != 0:
        fail("fresh-provider test account remains; refusing to reuse its state")
    print("e2e-demo-state: fresh-provider test account reset")


def main(mode):
    if mode == "reset":
        reset_seeded_demo_data()
    elif mode == "cleanup-qa":
        cleanup_qa_rows()
    elif mode == "reset-fresh-provider":
        reset_fresh_provider()
    else:
        fail("usage: e2e-demo-state.py reset|cleanup-qa|reset-fresh-provider")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
