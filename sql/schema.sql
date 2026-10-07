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
  context          text,                      -- sentence where the gap first occurred, as the user said it
  example          text,                      -- a correct everyday sentence using the word, written by the tutor
  source           text not null check (source in ('asked', 'fallback', 'error', 'topic_check')),
  ease             real not null default 2.5,
  interval_days    int  not null default 0,
  repetitions      int  not null default 0,
  due_on           date not null default current_date,
  created_at       timestamptz not null default now(),
  last_captured_at timestamptz not null default now()  -- bumped on re-capture; drives the session summary
);

-- Databases created before example sentences.
alter table items add column if not exists example text;

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

-- One photo per word, downloaded from Pexels or Wikimedia Commons and kept here
-- so posters print without depending on the other site.
create table if not exists pictures (
  item_id    bigint primary key references items(id) on delete cascade,
  mime       text not null,
  data       bytea not null,
  source     text not null,                 -- 'pexels' | 'wikimedia'
  page_url   text,                          -- the photo's page, for the credit
  author     text,
  license    text,
  query      text,                          -- what was searched for
  fetched_at timestamptz not null default now()
);

-- One finished round of the Lampo game (/game/<token>). Kept apart from
-- attempts: picking from four answers is not recall, so it never schedules.
create table if not exists game_rounds (
  id          bigserial primary key,
  score       int not null check (score >= 0),
  answered    int not null check (answered >= 0),
  correct     int not null check (correct between 0 and answered),
  best_streak int not null check (best_streak between 0 and correct),
  at          timestamptz not null default now()
);

-- Il Caso: a mystery the tutor tells in episodes across rides (see src/case.ts).
-- Its clues are hard words; the finale unlocks when every clue is secured.
create table if not exists cases (
  id         bigserial primary key,
  title      text not null,
  premise    text not null,
  solution   text not null,                 -- fixed when the case opens, revealed at the end
  story      text not null default '',      -- the story so far, rewritten after each episode
  episodes   int  not null default 0,
  outcome    text check (outcome in ('solved', 'dropped')),  -- null while open
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz
);
-- At most one open case.
create unique index if not exists cases_one_open on cases ((true)) where outcome is null;

create table if not exists case_clues (
  case_id    bigint not null references cases(id) on delete cascade,
  item_id    bigint not null references items(id) on delete cascade,
  ord        int not null,
  stage_seen int not null default 0,        -- the clue's stage at the last episode: setbacks and breakthroughs
  primary key (case_id, item_id)
);

create table if not exists case_episodes (
  case_id  bigint not null references cases(id) on delete cascade,
  n        int not null,
  headline text not null,
  at       timestamptz not null default now(),
  primary key (case_id, n)
);

-- Full-text search for the Words page; must match ITEM_DOC_SQL in src/store.ts.
drop index if exists items_fts_idx;
create index if not exists items_fts2_idx on items using gin (
  to_tsvector('simple', translate(lower(italian || ' ' || english || ' ' || coalesce(note, '') || ' ' || coalesce(context, '') || ' ' || coalesce(example, '')),
    'àáâäèéêëìíîïòóôöùúûü', 'aaaaeeeeiiiioooouuuu'))
);
