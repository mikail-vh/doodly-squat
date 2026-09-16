-- Doodly Squat — Postgres schema for Supabase.
--
-- Run this once in the Supabase SQL editor. The app connects as the `postgres`
-- role over the connection pooler, which owns these tables and therefore
-- bypasses RLS; RLS is switched on with *no policies* purely to slam the door
-- on Supabase's auto-generated PostgREST API, which is reachable by anyone
-- holding the (public by design) anon key.
--
-- Timestamps are stored as timestamptz so the Supabase table editor is
-- readable; the application reads them back as epoch milliseconds, which is
-- what its existing date handling expects.

create extension if not exists citext;

-- ---------------------------------------------------------------- accounts

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  display_name  text        not null,
  -- Null for password accounts with no email, and for OAuth providers that
  -- decline to share a verified address.
  email         citext      unique,
  -- Null for accounts that only ever sign in with Discord or Google.
  username      citext      unique,
  password_hash text,
  avatar_url    text,
  is_admin      boolean     not null default false,
  created_at    timestamptz not null default now()
  -- NOTE: a `check (username is not null or email is not null)` constraint
  -- belongs here, but only once username/password accounts exist. Until then
  -- the sole login route is OAuth, and lib/oauth.ts deliberately stores a null
  -- email whenever the provider reports the address unverified -- so the
  -- constraint would reject a sign-in that works fine today. Reinstate it in
  -- the same change that adds passwords.
);

create table if not exists oauth_accounts (
  provider    text        not null,
  provider_id text        not null,
  user_id     uuid        not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (provider, provider_id)
);
create index if not exists oauth_accounts_user_idx on oauth_accounts (user_id);

-- id is a SHA-256 of the cookie token, so a dumped database hands out no
-- usable sessions.
create table if not exists sessions (
  id         text        primary key,
  user_id    uuid        not null references users(id) on delete cascade,
  needs_totp boolean     not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx    on sessions (user_id);
create index if not exists sessions_expiry_idx  on sessions (expires_at);

create table if not exists totp_credentials (
  user_id      uuid        primary key references users(id) on delete cascade,
  secret       text        not null,
  confirmed_at timestamptz,
  last_step    bigint,
  created_at   timestamptz not null default now()
);

create table if not exists recovery_codes (
  user_id   uuid        not null references users(id) on delete cascade,
  code_hash text        not null,
  used_at   timestamptz,
  primary key (user_id, code_hash)
);

-- ----------------------------------------------------------------- invites

-- Registration is closed: an account can only be created by redeeming one of
-- these. Anonymous word-adding via a stash link is unaffected.
create table if not exists invites (
  code       text        primary key,
  note       text,
  created_by uuid        references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses   integer     not null default 1,
  uses       integer     not null default 0,
  revoked    boolean     not null default false
);
create index if not exists invites_created_by_idx on invites (created_by);

create table if not exists invite_redemptions (
  invite_code text        not null references invites(code) on delete cascade,
  user_id     uuid        not null references users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_code, user_id)
);

-- ------------------------------------------------------------ the word list

create table if not exists rooms (
  code       text        primary key,
  name       text        not null,
  created_at timestamptz not null default now()
);

create table if not exists words (
  id         bigint generated always as identity primary key,
  room_code  text        not null references rooms(code) on delete cascade,
  text       text        not null,
  added_by   text        not null default 'someone',
  user_id    uuid        references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists words_room_idx on words (room_code, id desc);
create index if not exists words_user_idx on words (user_id);
-- Case-insensitive uniqueness per stash, matching the old COLLATE NOCASE index.
create unique index if not exists words_unique_idx on words (room_code, lower(text));

-- -------------------------------------------------------------- game stats

-- Written by the self-hosted game server via POST /api/stats/results.
create table if not exists game_results (
  id            bigint generated always as identity primary key,
  match_id      text        not null,
  user_id       uuid        not null references users(id) on delete cascade,
  played_at     timestamptz not null default now(),
  score         integer     not null default 0,
  rounds        integer     not null default 0,
  words_guessed integer     not null default 0,
  words_drawn   integer     not null default 0,
  guessed_first integer     not null default 0,
  won           boolean     not null default false,
  -- A replayed ingest of the same match must not double-count anyone.
  unique (match_id, user_id)
);
create index if not exists game_results_user_idx on game_results (user_id, played_at desc);

-- ------------------------------------------------------- lock the REST API

-- No policies are defined, so every request arriving through PostgREST with an
-- anon or authenticated key is denied. The app's own connection is unaffected
-- because the table owner bypasses RLS.
alter table users              enable row level security;
alter table oauth_accounts     enable row level security;
alter table sessions           enable row level security;
alter table totp_credentials   enable row level security;
alter table recovery_codes     enable row level security;
alter table invites            enable row level security;
alter table invite_redemptions enable row level security;
alter table rooms              enable row level security;
alter table words              enable row level security;
alter table game_results       enable row level security;
