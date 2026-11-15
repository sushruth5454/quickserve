import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'migrations', '0020_proposal_milestone_booking.sql'), 'utf8');
const checks = [
  ['service request table', /create table if not exists public\.service_requests/i],
  ['provider projection', /create or replace view public\.service_request_provider_view/i],
  ['private request table', /create table if not exists public\.request_private/i],
  ['recipient uniqueness', /primary key \(request_id, provider_id\)/i],
  ['proposal items and schedule', /create table if not exists public\.proposal_items[\s\S]+create table if not exists public\.proposal_schedule/i],
  ['fixed snapshots', /proposal booking snapshots are immutable/i],
  ['atomic accept lock', /for update[\s\S]+service_request_id = v_request\.id/i],
  ['30 minute hold', /now\(\) \+ interval '30 minutes'/i],
  ['schedule-scoped payment', /prepare_schedule_payment[\s\S]+schedule_id = ps\.id/i],
  ['expiry reopen', /payment hold expired[\s\S]+status = case when expires_at > now\(\) then 'open'/i],
  ['deliverable guard', /all milestones must be paid before accepting delivery/i],
  ['request masking', /_proposal_public_intake/i],
  ['recipient-only routing', /route_service_request/i],
  ['notification vocabulary', /proposal_request_received[\s\S]+milestone_due[\s\S]+delivery_submitted/i],
  ['RLS enabled', /alter table public\.request_private enable row level security[\s\S]+alter table public\.payment_schedule enable row level security/i],
];
const failed = checks.filter(([, pattern]) => !pattern.test(sql));
checks.filter(([, pattern]) => pattern.test(sql)).forEach(([name]) => console.log(`ok  : ${name}`));
failed.forEach(([name]) => console.error(`FAIL: ${name}`));
if (failed.length) process.exit(1);
