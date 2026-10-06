-- Italian Voice Tutor schema. Idempotent: safe to run on every boot.
-- Paste into the Supabase / Neon SQL editor, or let the server apply it on start.

create table if not exists sessions (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  limit_min   int check (limit_min is null or limit_min > 0),  -- null = no limit
  ended_at    timestamptz
);

create table if not exists items (
  id               bigserial primary key,
  italian          text not null,             -- word, phrase or corrected form
  english          text not null,
  note             text,                      -- e.g. "masculine", "plural agreement"
  context          text,                      -- sentence where the gap first occurred
  source           text not null check (source in ('asked', 'fallback', 'error', 'topic_check')),
  ease             real not null default 2.5,
  interval_days    int  not null default 0,
  repetitions      int  not null default 0,
  due_on           date not null default current_date,
  created_at       timestamptz not null default now(),
  last_captured_at timestamptz not null default now()  -- bumped on re-capture; drives the session summary
);

-- Uniqueness is case-insensitive so "Lo schermo" and "lo schermo" are one item.
create unique index if not exists items_italian_lower_key on items (lower(italian));
create index if not exists items_due_idx on items (due_on, ease);

create table if not exists attempts (
  id         bigserial primary key,
  item_id    bigint not null references items(id) on delete cascade,
  session_id bigint references sessions(id) on delete set null,
  mode       text not null check (mode in ('word', 'sentence', 'screen')),  -- screen = the drill page
  prompt     text,                            -- English prompt given (log only, never reused)
  answer     text,                            -- transcribed user answer
  grade      int  not null check (grade between 0 and 5),  -- SM-2 quality 0..5
  fillers    int  not null default 0,
  at         timestamptz not null default now()
);

-- Databases created before the drill page only allowed the two voice modes.
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'attempts_mode_check' and pg_get_constraintdef(oid) like '%screen%') then
    alter table attempts drop constraint if exists attempts_mode_check;
    alter table attempts add constraint attempts_mode_check check (mode in ('word', 'sentence', 'screen'));
  end if;
end $$;

create index if not exists attempts_session_idx on attempts (session_id);
create index if not exists attempts_item_idx on attempts (item_id);

-- Full-text search for the Words page; must match ITEM_DOC_SQL in src/store.ts.
create index if not exists items_fts_idx on items using gin (
  to_tsvector('simple', translate(lower(italian || ' ' || english || ' ' || coalesce(note, '') || ' ' || coalesce(context, '')),
    'àáâäèéêëìíîïòóôöùúûü', 'aaaaeeeeiiiioooouuuu'))
);
