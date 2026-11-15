-- Retrieval functions, RLS and storage ------------------------------------

-- Structured + keyword filtering for the Investigation Explorer ----------------
create or replace function filter_investigations(
  q text default null, category text default null, phenomenon text default null,
  gravity_class text default null, fuel text default null, material text default null,
  o2_min double precision default null, o2_max double precision default null,
  p_min double precision default null, p_max double precision default null,
  t_min double precision default null, t_max double precision default null,
  year_min int default null, year_max int default null,
  sort text default 'relevance', lim int default 20, off int default 0
) returns table(id uuid, rank real, total bigint)
language sql stable as $$
  with base as (
    select i.id, i.title, i.created_at,
      case when coalesce(q,'') = '' then 0
           else ts_rank(i.fts, websearch_to_tsquery('english', q)) end as rank,
      (select max(p.publication_year) from publications p where p.investigation_id = i.id) as yr
    from investigations i
    where (coalesce(q,'') = '' or i.fts @@ websearch_to_tsquery('english', q)
           or i.title ilike '%'||q||'%' or i.investigation_code ilike '%'||q||'%')
      and (category is null or i.research_category = category)
      and (phenomenon is null or exists (select 1 from unnest(i.combustion_phenomena) ph where ph ilike '%'||phenomenon||'%'))
      and (gravity_class is null or exists (select 1 from experimental_conditions c
            where c.investigation_id = i.id and c.parameter_key = 'gravity' and c.value_class = gravity_class))
      and (fuel is null or exists (select 1 from experimental_conditions c
            where c.investigation_id = i.id and c.parameter_key = 'fuel' and c.value ilike '%'||fuel||'%'))
      and (material is null or exists (select 1 from experimental_conditions c
            where c.investigation_id = i.id and c.parameter_key = 'material' and c.value ilike '%'||material||'%'))
      and ((o2_min is null and o2_max is null) or exists (select 1 from experimental_conditions c
            where c.investigation_id = i.id and c.parameter_key = 'oxygen_concentration'
              and c.normalized_value between coalesce(o2_min,-1e308) and coalesce(o2_max,1e308)))
      and ((p_min is null and p_max is null) or exists (select 1 from experimental_conditions c
            where c.investigation_id = i.id and c.parameter_key = 'pressure'
              and c.normalized_value between coalesce(p_min,-1e308) and coalesce(p_max,1e308)))
      and ((t_min is null and t_max is null) or exists (select 1 from experimental_conditions c
            where c.investigation_id = i.id and c.parameter_key = 'temperature'
              and c.normalized_value between coalesce(t_min,-1e308) and coalesce(t_max,1e308)))
      and ((year_min is null and year_max is null) or exists (select 1 from publications p
            where p.investigation_id = i.id
              and p.publication_year between coalesce(year_min,0) and coalesce(year_max,9999)))
  )
  select b.id, b.rank::real, count(*) over () as total
  from base b
  order by
    case when sort = 'relevance' then b.rank end desc nulls last,
    case when sort = 'title' then b.title end asc,
    case when sort = 'year' then b.yr end desc nulls last,
    case when sort = 'recent' then b.created_at end desc,
    b.title asc
  limit greatest(lim,1) offset greatest(off,0);
$$;

-- Hybrid chunk retrieval: full-text + pgvector fused by reciprocal rank ---------
create or replace function hybrid_search_chunks(
  q text, q_emb vector(768) default null,
  inv_ids uuid[] default null, pub_ids uuid[] default null,
  match_count int default 10, rrf_k int default 60
) returns table(id uuid, publication_id uuid, investigation_id uuid, content text, page_number int,
                section text, evidence_layer text, score double precision, fts_rank int, vec_rank int)
language sql stable as $$
  with ft as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, websearch_to_tsquery('english', q)) desc) as r
    from research_chunks c
    where coalesce(q,'') <> '' and c.fts @@ websearch_to_tsquery('english', q)
      and (inv_ids is null or c.investigation_id = any(inv_ids))
      and (pub_ids is null or c.publication_id = any(pub_ids))
    order by ts_rank_cd(c.fts, websearch_to_tsquery('english', q)) desc
    limit greatest(match_count,1) * 3
  ), vec as (
    select c.id, row_number() over (order by c.embedding <=> q_emb) as r
    from research_chunks c
    where q_emb is not null and c.embedding is not null
      and (inv_ids is null or c.investigation_id = any(inv_ids))
      and (pub_ids is null or c.publication_id = any(pub_ids))
    order by c.embedding <=> q_emb
    limit greatest(match_count,1) * 3
  ), fused as (
    select coalesce(ft.id, vec.id) as id,
           coalesce(1.0/(rrf_k + ft.r), 0) + coalesce(1.0/(rrf_k + vec.r), 0) as score,
           ft.r::int as fts_rank, vec.r::int as vec_rank
    from ft full join vec on ft.id = vec.id
  )
  select c.id, c.publication_id, c.investigation_id, c.content, c.page_number, c.section,
         c.evidence_layer, f.score, f.fts_rank, f.vec_rank
  from fused f join research_chunks c on c.id = f.id
  order by f.score desc
  limit greatest(match_count,1);
$$;

-- Dashboard statistics (real counts only) ---------------------------------------
create or replace function dashboard_statistics() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'investigations', (select count(*) from investigations),
    'publications', (select count(*) from publications),
    'datasets', (select count(*) from experimental_datasets),
    'figures', (select count(*) from figures),
    'categories', (select count(distinct research_category) from investigations where research_category is not null),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', research_category, 'count', n) order by n desc)
        from (select research_category, count(*) n from investigations where research_category is not null group by 1) s), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('name', investigation_type, 'count', n) order by n desc)
        from (select investigation_type, count(*) n from investigations where investigation_type is not null group by 1) s), '[]'::jsonb),
    'by_phenomenon', coalesce((select jsonb_agg(jsonb_build_object('name', ph, 'count', n) order by n desc)
        from (select ph, count(*) n from investigations, unnest(combustion_phenomena) ph group by 1) s), '[]'::jsonb),
    'by_gravity', coalesce((select jsonb_agg(jsonb_build_object('name', value_class, 'count', n) order by n desc)
        from (select value_class, count(distinct investigation_id) n from experimental_conditions
              where parameter_key = 'gravity' and value_class is not null group by 1) s), '[]'::jsonb)
  );
$$;

-- Row Level Security -------------------------------------------------------------
-- The backend uses the service-role key (bypasses RLS). Browsers use the anon key
-- and may only READ research content and their own validation records.
do $$
declare t text;
begin
  foreach t in array array['investigations','publications','experimental_conditions','scientific_findings',
    'research_chunks','figures','experimental_datasets','experimental_data','fire_safety_applications',
    'mission_relevance','validation_sessions','validation_issues','admin_users','ai_usage_log','ingestion_reports']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
  foreach t in array array['investigations','publications','experimental_conditions','scientific_findings',
    'research_chunks','figures','experimental_datasets','experimental_data','fire_safety_applications','mission_relevance']
  loop
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

create policy "own sessions read" on validation_sessions for select to authenticated using (user_id = auth.uid());
create policy "own issues read" on validation_issues for select to authenticated
  using (exists (select 1 from validation_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "self admin check" on admin_users for select to authenticated using (user_id = auth.uid());
-- ai_usage_log, ingestion_reports: no policies => service role only.

revoke execute on function filter_investigations from anon, authenticated;
revoke execute on function hybrid_search_chunks from anon, authenticated;

-- Storage (private buckets; backend hands out short-lived signed URLs) -------------
insert into storage.buckets (id, name, public) values
  ('research-documents','research-documents', false),
  ('research-figures','research-figures', false),
  ('research-datasets','research-datasets', false)
on conflict (id) do nothing;
