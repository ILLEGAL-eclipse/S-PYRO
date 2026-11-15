-- S-PYRO core schema -------------------------------------------------------
-- Three evidence layers are kept distinct:
--   1. original scientific evidence  (publications + original PDFs + research_chunks.evidence_layer='original')
--   2. structured extracted info      (conditions, findings, figures, datasets)
--   3. AI-generated interpretation    (investigations.research_summary, chunks.evidence_layer='ai_interpretation')

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- helpers
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- investigations
create table investigations (
  id uuid primary key default gen_random_uuid(),
  investigation_code text not null unique,
  title text not null,
  description text,
  abstract text,
  research_category text,
  investigation_type text,                       -- e.g. flight experiment, ground-based, numerical
  combustion_phenomena text[] not null default '{}',
  keywords text[] not null default '{}',
  objectives text[] not null default '{}',
  methodology text,                              -- from methodology.md (extracted layer)
  research_summary text,                         -- from research_summary.md (AI-generated layer, never treated as fact)
  "references" jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index investigations_fts_idx on investigations using gin (fts);
create index investigations_category_idx on investigations (research_category);
create index investigations_phenomena_idx on investigations using gin (combustion_phenomena);
create index investigations_title_trgm on investigations using gin (title gin_trgm_ops);

create or replace function investigations_fts_update() returns trigger language plpgsql as $$
begin
  new.fts :=
    setweight(to_tsvector('english', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.investigation_code,'')), 'A') ||
    setweight(to_tsvector('english', array_to_string(new.keywords,' ') || ' ' || array_to_string(new.combustion_phenomena,' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.description,'') || ' ' || coalesce(new.abstract,'') || ' ' || array_to_string(new.objectives,' ')), 'C');
  return new;
end $$;
create trigger investigations_fts_trg before insert or update on investigations
  for each row execute function investigations_fts_update();
create trigger investigations_updated before update on investigations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- publications
create table publications (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  title text not null,
  authors text[] not null default '{}',
  publication_year int check (publication_year between 1900 and 2100),
  doi text,
  journal text,
  publication_type text,
  original_file_path text,                       -- path in storage bucket research-documents (original PDF, unchanged)
  source_url text,
  abstract text,
  file_sha256 text,
  created_at timestamptz not null default now(),
  unique (investigation_id, title)
);
create unique index publications_doi_uidx on publications (lower(doi)) where doi is not null;
create index publications_inv_idx on publications (investigation_id);
create index publications_year_idx on publications (publication_year);

-- ---------------------------------------------------------------- experimental conditions
create table experimental_conditions (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  publication_id uuid references publications(id) on delete cascade,
  parameter text not null,                       -- as written in the source
  parameter_key text,                            -- canonical key (oxygen_concentration, pressure, ...)
  value text not null,                           -- as written in the source
  value_numeric double precision,                -- parsed (first number / range midpoint not used: see value_min/max)
  value_min double precision,
  value_max double precision,
  unit text,
  normalized_value double precision,             -- canonical unit (%, kPa, K, g, ...)
  normalized_unit text,
  value_class text,                              -- e.g. microgravity / partial / normal for gravity
  context text,
  source_page int,
  source_section text,
  source_table text,
  source_figure text,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (investigation_id, content_hash)
);
create index conditions_inv_idx on experimental_conditions (investigation_id);
create index conditions_key_idx on experimental_conditions (parameter_key, normalized_value);
create index conditions_pub_idx on experimental_conditions (publication_id);

-- ---------------------------------------------------------------- scientific findings
create table scientific_findings (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  publication_id uuid references publications(id) on delete cascade,
  description text not null,
  evidence_type text not null default 'other'
    check (evidence_type in ('experimental_observation','numerical_result','theoretical','author_interpretation','review','other')),
  phenomenon text,
  reported_values jsonb not null default '{}'::jsonb,
  source_page int,
  source_section text,
  source_figure text,
  source_table text,
  content_hash text not null,
  fts tsvector generated always as (to_tsvector('english', coalesce(description,'') || ' ' || coalesce(phenomenon,''))) stored,
  created_at timestamptz not null default now(),
  unique (investigation_id, content_hash)
);
create index findings_inv_idx on scientific_findings (investigation_id);
create index findings_fts_idx on scientific_findings using gin (fts);

-- ---------------------------------------------------------------- research chunks
create table research_chunks (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid references publications(id) on delete cascade,
  investigation_id uuid not null references investigations(id) on delete cascade,
  content text not null,
  page_number int,
  section text,
  chunk_index int not null default 0,
  evidence_layer text not null default 'original'
    check (evidence_layer in ('original','extracted','ai_interpretation')),
  content_hash text not null,
  embedding vector(768),                         -- nullable: backfilled by admin job
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (investigation_id, content_hash)
);
create index chunks_inv_idx on research_chunks (investigation_id);
create index chunks_pub_page_idx on research_chunks (publication_id, page_number);
create index chunks_fts_idx on research_chunks using gin (fts);
create index chunks_embedding_idx on research_chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- figures
create table figures (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  publication_id uuid references publications(id) on delete cascade,
  figure_number text not null,
  caption text,
  page_number int,
  image_path text,                               -- storage bucket research-figures
  x_axis text,
  y_axis text,
  units text,
  description text,
  qualitative_observations text,
  created_at timestamptz not null default now(),
  unique (investigation_id, publication_id, figure_number)
);
create index figures_inv_idx on figures (investigation_id);

-- ---------------------------------------------------------------- datasets
create table experimental_datasets (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  publication_id uuid references publications(id) on delete cascade,
  dataset_name text not null,
  description text,
  file_path text,
  source_page int,
  source_table text,
  created_at timestamptz not null default now(),
  unique (investigation_id, dataset_name)
);
create index datasets_inv_idx on experimental_datasets (investigation_id);

create table experimental_data (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references experimental_datasets(id) on delete cascade,
  row_index int not null default 0,              -- groups variables belonging to the same table row
  variable text not null,
  value double precision not null,               -- numeric extracted values only
  unit text,
  experimental_condition text,
  source_reference text
);
create index data_dataset_idx on experimental_data (dataset_id, variable, row_index);

-- ---------------------------------------------------------------- fire safety & missions
create table fire_safety_applications (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  application_category text not null check (application_category in (
    'fire_detection','smoke_monitoring','fire_suppression','fine_water_mist','material_flammability',
    'oxygen_management','ventilation','fire_resistant_materials','protective_equipment')),
  description text not null,
  supporting_finding_id uuid references scientific_findings(id) on delete set null,
  evidence_type text,
  application_status text not null default 'potential' check (application_status in ('demonstrated','potential')),
  limitations text,
  created_at timestamptz not null default now()
);
create index fsa_inv_idx on fire_safety_applications (investigation_id);
create index fsa_cat_idx on fire_safety_applications (application_category);

create table mission_relevance (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  mission_type text not null,
  relevance_score numeric check (relevance_score between 0 and 1),
  rationale text,
  supporting_evidence jsonb not null default '[]'::jsonb,
  limitations text,
  created_at timestamptz not null default now()
);
create index mission_inv_idx on mission_relevance (investigation_id);

-- ---------------------------------------------------------------- validation
create table validation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  submitted_input jsonb not null,                -- original input, immutable
  input_type text not null,
  status text not null default 'completed' check (status in ('processing','completed','failed')),
  context jsonb not null default '{}'::jsonb,    -- resolved investigation, warnings, counts
  created_at timestamptz not null default now()
);
create index vsessions_user_idx on validation_sessions (user_id, created_at desc);

create table validation_issues (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references validation_sessions(id) on delete cascade,
  issue_type text not null,                      -- numerical, unit, condition, finding, citation, duplicate, missing_value, ...
  classification text not null check (classification in ('MATCH','DISCREPANCY','CONTEXT MISMATCH','NOT FOUND','INSUFFICIENT EVIDENCE')),
  parameter text,
  researcher_value text,
  source_value text,
  publication_id uuid references publications(id) on delete set null,
  investigation_id uuid references investigations(id) on delete set null,
  source_page int,
  source_section text,
  source_figure text,
  source_table text,
  source_record jsonb not null default '{}'::jsonb,   -- id of the condition/finding the comparison used
  explanation text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','not_applicable')),
  researcher_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vissues_session_idx on validation_issues (session_id);

-- original input and comparison results can never be edited; only status/note change
create or replace function validation_sessions_immutable() returns trigger language plpgsql as $$
begin
  if new.submitted_input is distinct from old.submitted_input or new.input_type is distinct from old.input_type
     or new.user_id is distinct from old.user_id then
    raise exception 'validation_sessions.submitted_input is immutable';
  end if;
  return new;
end $$;
create trigger validation_sessions_immutable_trg before update on validation_sessions
  for each row execute function validation_sessions_immutable();

create or replace function validation_issues_immutable() returns trigger language plpgsql as $$
begin
  if to_jsonb(new) - 'status' - 'researcher_note' - 'updated_at'
     is distinct from to_jsonb(old) - 'status' - 'researcher_note' - 'updated_at' then
    raise exception 'validation_issues comparison results are immutable; only status and researcher_note may change';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger validation_issues_immutable_trg before update on validation_issues
  for each row execute function validation_issues_immutable();

-- ---------------------------------------------------------------- admin, usage, ingestion
create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table ai_usage_log (
  id bigserial primary key,
  user_id uuid,
  endpoint text not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  tool_calls int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create table ingestion_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  investigation_id uuid references investigations(id) on delete set null,
  report jsonb not null,
  created_at timestamptz not null default now()
);
