-- QuickServe AI v2: conversation titles (history list), usage events for voice/photo limits, per-answer feedback,
-- product analytics events and a private bucket for diagnosis photos. See docs/06-AI-Assistant.md.

-- History list: short title from the first customer message (PII-redacted by the edge function).
alter table public.ai_conversations add column if not exists title text check (char_length(title) <= 80);

-- Metered work that is not a chat message: voice transcriptions, legacy voice chats and photos.
-- Written only by the edge function; counted for AI_DAILY_VOICE_LIMIT / AI_DAILY_PHOTO_LIMIT and the burst limit.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('transcribe', 'voice_chat', 'photo')),
  request_id uuid,
  created_at timestamptz not null default now()
);
create index ai_usage_user_day_idx on public.ai_usage (user_id, kind, created_at desc);
alter table public.ai_usage enable row level security;
create policy ai_usage_own_read on public.ai_usage for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- Thumbs up/down per assistant answer for quality review. Fixed reason codes only (no free text = no PII).
create table public.ai_feedback (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.ai_messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  reason text check (reason in ('wrong_service', 'wrong_price', 'wrong_pro', 'language', 'not_helpful', 'unsafe', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);
alter table public.ai_feedback enable row level security;
create policy ai_feedback_own_read on public.ai_feedback for select to authenticated using (user_id = auth.uid());
create policy ai_feedback_own_insert on public.ai_feedback for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.ai_messages m where m.id = message_id and m.user_id = auth.uid() and m.role = 'assistant')
);
create policy ai_feedback_own_update on public.ai_feedback for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.ai_messages m where m.id = message_id and m.user_id = auth.uid() and m.role = 'assistant')
  );
create policy ai_feedback_own_delete on public.ai_feedback for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.ai_feedback to authenticated;

-- Product analytics (assistant funnel). Insert-only for the signed-in user; readable by service role/admins only.
-- Event names are an allow-list and props are small, so free text / PII cannot be logged by mistake.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  event text not null check (event in (
    'assistant_opened', 'voice_used', 'photo_attached', 'stage_latency', 'draft_created',
    'draft_to_booking_conversion', 'fallback_model_used', 'assistant_feedback', 'assistant_stopped', 'support_handoff'
  )),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 2048),
  created_at timestamptz not null default now()
);
create index analytics_events_event_idx on public.analytics_events (event, created_at desc);
alter table public.analytics_events enable row level security;
create policy analytics_events_own_insert on public.analytics_events for insert to authenticated with check (user_id = auth.uid());
grant insert on public.analytics_events to authenticated;

-- Diagnosis photos: private, owner-readable, written only by the edge function (EXIF/metadata stripped server-side).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-photos', 'ai-photos', false, 4000000, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy storage_ai_photos_own_read on storage.objects for select to authenticated using (
  bucket_id = 'ai-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
