# S-PYRO — NASA Combustion Science Research Intelligence

Explore · Understand · Discover. S-PYRO helps researchers find, organise, compare and understand documented NASA combustion
investigations, and checks their own inputs against the stored sources. **It assists; researchers decide.** It never prescribes
engineering solutions or declares scientific information wrong.

```
Next.js (React, Tailwind)  ──►  FastAPI (Python)  ──►  Supabase (Postgres + pgvector + Storage + Auth)
      browser: anon key only        service-role key         ▲
                                    Gemini API key ──► Gemini (function calling over controlled tools)
```

| Folder | Contents |
|---|---|
| `supabase/migrations` | Schema, RLS, hybrid-search SQL functions, storage buckets |
| `backend` | FastAPI app (`app/routers`, `app/services`), tests |
| `frontend` | Next.js App Router UI |
| `docs` | `INGESTION_FORMAT.md`, `sample-package/` (format example, **not real data**) |
| `scripts` | `apply_migrations.py` |

## Setup

### 1. Supabase
1. Create a project; enable the `vector` extension is handled by the migration.
2. Apply migrations: `supabase db push`, **or** put the Postgres connection string in `backend/.env` as `DATABASE_URL` and run
   `python scripts/apply_migrations.py`, **or** paste both files from `supabase/migrations` into the SQL editor (in order).
3. Create your account (sign up in the app), then make yourself an administrator in the SQL editor:
   ```sql
   insert into admin_users (user_id) select id from auth.users where email = 'you@example.org';
   ```

### 2. Backend
```bash
cd backend
python -m venv .venv && .venv\Scripts\activate        # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
copy .env.example .env                                  # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, GEMINI_MODEL
uvicorn app.main:app --reload --port 8000
pytest                                                  # deterministic engine tests (no DB or Gemini required)
```
`GEMINI_MODEL` is whatever Gemini model id you choose (e.g. one from <https://ai.google.dev/gemini-api/docs/models>); nothing is hard-coded.
Without Gemini, everything except the assistant, AI summaries, AI free-text extraction and AI finding-comparison still works.

### 3. Frontend
```bash
cd frontend
npm install
copy .env.example .env.local     # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
npm run dev                      # http://localhost:3000
```

### 4. Load research
Sign in as admin → **Data ingestion** → upload a package (see [`docs/INGESTION_FORMAT.md`](docs/INGESTION_FORMAT.md)) →
*Validate only* → *Ingest package* → *Embed pending chunks* (enables semantic search).

## How the pieces work

* **Retrieval** — `app/services/retrieval.py` holds the controlled tools: `search_investigations`, `search_publications`,
  `search_research_text`, `get_investigation_details`, `get_experimental_conditions`, `get_scientific_findings`,
  `get_figure_descriptions`, `get_experimental_data`, `get_fire_safety_applications`; plus `compare_investigations` and
  `rank_investigations`. Every parameter is validated by Pydantic. Gemini has no SQL access.
  Text search is *hybrid*: structured filters + PostgreSQL full-text + pgvector, fused by reciprocal rank in SQL
  (`hybrid_search_chunks`). Chunks without embeddings still match by keyword.
* **Assistant** — `POST /api/assistant/query` runs a bounded Gemini function-calling loop (configurable rounds). Each retrieved
  record is registered with a ref (`R1`…); the answer may only cite those refs, unknown refs are stripped, numbers that do not
  appear in retrieved records are flagged, and token usage is logged to `ai_usage_log`. Citations link to
  `/publications/{id}?page=N`, which opens the stored original PDF at that page.
* **Validation** — `app/services/validation.py`. Python performs all numeric, unit-aware, categorical, missing-value and duplicate
  comparisons (`units.py`). Gemini is only used to (1) extract statements from free text — each must quote the input verbatim,
  (2) map differently-worded parameter names to *existing* database parameters (validated), and (3) judge claims against
  retrieved findings — it must quote the finding verbatim or the result is downgraded to INSUFFICIENT EVIDENCE.
  Results are `MATCH`, `DISCREPANCY`, `CONTEXT MISMATCH`, `NOT FOUND`, `INSUFFICIENT EVIDENCE`; every one carries the stored source
  record. Input and results are immutable in the database (triggers); researchers can only set status/notes.
  Equality uses a 0.1 % relative tolerance (`VALIDATION_REL_TOL`); the difference is always shown, never hidden.
* **Mission analysis** — transparent scoring (documented in the API response): similarity of requested gravity, oxygen,
  pressure and temperature to documented conditions, optionally blended with text relevance of the objective. Presets only
  fill physical gravity; atmospheric values are never assumed. Scores are discovery aids, not safety ratings.
* **Data explorer** — charts only numeric values that were ingested from tables; series with different units never share an axis.

## Security & cost controls
* Gemini and service-role keys exist only in `backend/.env`. The frontend only has the public anon key.
* RLS is enabled on every table: browsers can read research content and their own validation records; all writes go through the
  backend. Ingestion, embedding and usage endpoints require a user listed in `admin_users`.
* Rate limits (`RATE_LIMIT_*`), capped result counts (`RETRIEVAL_MAX_RESULTS`), tool-round and output-token budgets, per-tool
  result size caps, retrieval of chunks instead of whole papers. Usage and errors are logged without credentials.
* Storage buckets are private; PDFs and figures are served by short-lived signed URLs.

## Testing status — read this
* Verified here: backend unit tests (`pytest`: unit conversion, comparison engine, citation stripping, tool validation,
  package validation), TypeScript type-check, production `next build`, both servers boot and return correct errors without
  credentials, and the SQL migrations were syntax-checked with the PostgreSQL parser (`pglast`).
* **Not verified in this environment** (no Supabase project or Gemini key was available): running the migrations on a real
  database, live PostgREST/RPC calls, storage uploads, Gemini function calling, and visual review of the UI in a browser.
  Expect to fix small integration issues on first run against real credentials; start with *Validate only* ingestion and the
  `/health` endpoint.

## Deployment
* Frontend: any Next.js host (e.g. Vercel). Set the three `NEXT_PUBLIC_*` variables.
* Backend: any container/VM host: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` behind HTTPS. Set the backend env vars and
  `CORS_ORIGINS` to the frontend origin. Rate limiting is in-memory per process; use a shared store if you run several workers.
* Keep `.env` files out of version control.
