# S-PYRO – run locally

S-PYRO = Next.js frontend + FastAPI backend + Supabase (Postgres + PDF storage) + Gemini.
This package is already connected to the shared Supabase project (database, PDFs and embeddings are all there),
so there is nothing to create or ingest. The env files are included.

**Keep this folder private.** `backend/.env` contains a Supabase secret key and a Gemini key. Don't upload it to GitHub,
public drives or chat groups.

## 1. Install
- VS Code
- Python 3.11+ (tick "Add to PATH" on Windows)
- Node.js 20+ (includes npm)

## 2. Run (two VS Code terminals)
```powershell
# Terminal 1 – backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 – frontend
cd frontend
npm install
npm run dev
```
Open http://localhost:3000 (API docs: http://localhost:8000/docs).
If port 3000 is busy: `npm run dev -- -p 3107` (3107 is already allowed by the backend CORS list).

## 3. Check
- Overview page shows investigations and statistics → backend + database OK.
- Open an investigation → Publications tab → the PDF opens → storage OK.
- AI Assistant answers → Gemini key/model OK.
- Tests (no network needed): `cd backend && pytest`

## Troubleshooting
- "Cannot reach backend": backend terminal not running, or you opened the site on a port not listed in `CORS_ORIGINS` in `backend/.env`.
- Assistant error / 404 on model: change `GEMINI_MODEL` in `backend/.env` to a model your key can use.
- `python` not found: reinstall Python with "Add to PATH", or use `py` instead of `python`.

## For reference
- `docs/INGESTION_FORMAT.md` – how to add new papers; `scripts/` – converters and ingest tools (run from `backend/`).
- `data/packages/` – the converted data already loaded into the database.
- `supabase/migrations/` – schema, only needed if you ever create a new Supabase project.
