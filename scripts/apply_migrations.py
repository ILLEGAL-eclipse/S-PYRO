"""Apply supabase/migrations/*.sql to the database in DATABASE_URL (alternative to `supabase db push`).

Usage:  python scripts/apply_migrations.py        (reads backend/.env)
Migrations are not tracked; run once on a fresh project.
"""
import pathlib
import sys

import psycopg
from pydantic_settings import BaseSettings, SettingsConfigDict


class S(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(pathlib.Path(__file__).parent.parent / "backend" / ".env"), extra="ignore")
    database_url: str = ""


def main() -> int:
    url = S().database_url
    if not url:
        print("DATABASE_URL is not set in backend/.env")
        return 1
    files = sorted((pathlib.Path(__file__).parent.parent / "supabase" / "migrations").glob("*.sql"))
    with psycopg.connect(url, autocommit=True) as conn:
        for f in files:
            print(f"Applying {f.name} ...")
            conn.execute(f.read_text(encoding="utf-8"))
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
