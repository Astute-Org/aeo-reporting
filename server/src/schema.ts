// The database, as SQL applied on every boot (every statement is idempotent).
//
// Four decisions worth stating, because each is cheap now and expensive later:
//
// 1. Raw engine responses are kept on `answers`. Scoring rules will change,
//    and without the raw payload a rule change means re-asking - and re-paying
//    - every engine for every historical reading. Storage is the cheapest
//    thing in this system.
//
// 2. Panels are versioned, never edited. Reading-on-reading comparison is the
//    entire product, and it is meaningless if the question set drifted under
//    it. A changed panel is a new version with its own row, and every run
//    points at the version it actually asked.
//
// 3. Answers are stored per repeat, not averaged on write. The variance
//    between repeats is what says whether a move between readings is real.
//
// 4. Observations are separate rows from answers. One answer routinely yields
//    several hits - the site cited, the company named without a link, a
//    competitor recommended - and they are different metrics.

export const SCHEMA = `
create table if not exists companies (
  id text primary key,
  name text not null,
  domain text,
  url text,
  canonical_url text,
  aliases text not null default '[]',
  competitors text not null default '[]',
  notes text,
  created_at text not null,
  updated_at text not null
);

create table if not exists panels (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  version integer not null default 1,
  is_active integer not null default 1,
  category text,
  cadence_hours integer not null default 240,
  repeats integer not null default 1 check (repeats between 1 and 10),
  last_run_at text,
  created_at text not null,
  unique (company_id, version)
);
create index if not exists panels_company_idx on panels (company_id);

create table if not exists prompts (
  id text primary key,
  panel_id text not null references panels(id) on delete cascade,
  text text not null,
  intent text not null check (intent in ('discovery', 'comparison', 'validation', 'implementation')),
  position integer,
  created_at text not null
);
create index if not exists prompts_panel_idx on prompts (panel_id);

create table if not exists runs (
  id text primary key,
  panel_id text not null references panels(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at text not null,
  completed_at text,
  error text,
  answers_expected integer,
  answers_ok integer,
  answers_failed integer
);
create index if not exists runs_panel_idx on runs (panel_id, started_at);

create table if not exists answers (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  prompt_id text not null references prompts(id) on delete cascade,
  engine text not null,
  repeat_index integer not null default 0,
  answer_text text,
  raw text,
  input_tokens integer,
  output_tokens integer,
  search_count integer,
  status text not null default 'ok' check (status in ('ok', 'failed')),
  error text,
  created_at text not null,
  unique (run_id, prompt_id, engine, repeat_index)
);
create index if not exists answers_run_idx on answers (run_id);

create table if not exists observations (
  id integer primary key autoincrement,
  answer_id text not null references answers(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  kind text not null check (kind in ('retrieved', 'cited', 'linked_mention', 'unlinked_mention')),
  subject text not null check (subject in ('company', 'competitor')),
  matched_on text not null check (matched_on in ('exact_url', 'domain', 'brand_name')),
  label text,
  url text,
  domain text,
  position integer,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  context text check (context in ('recommended', 'compared', 'dismissed', 'passing')),
  created_at text not null
);
create index if not exists observations_answer_idx on observations (answer_id);
`;
