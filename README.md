# UST Track

Degree and timetable planning for HKUST undergraduates.

This repo is a **framework only**: schema, API stubs, and UI shells. Parsers, ingestion, timetable behavior, and the LLM advisor are not implemented yet.

## Stack

- **Web:** React + Vite + TypeScript + Tailwind
- **API:** FastAPI stubs under `/api`
- **Database:** Supabase Postgres (`catalog` and `planner` schemas), via the session pooler in `DATABASE_URL`
- **Advisor (later):** OpenRouter-backed agent that reads catalog/planner rows and drafts a timetable plus a degree plan
- **Search (later):** Postgres FTS / trigram. Qdrant is deferred.

## Layout

```text
backend/                 FastAPI, SQLAlchemy 2, Alembic
  app/models/            catalog + planner + ingestion tables
  app/ingestion/         WCQ / SIS stubs
  app/services/          search, conflicts, ics, rules, advisor stubs
  app/api/               route stubs
frontend/                Vite + React shells
data/raw/                official HTML + PDFs (gitignored)
data/sample-sis.txt      SIS paste fixture placeholder
```

## Setup

```bash
cp .env.example .env

python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cd backend && alembic upgrade head && cd ..

# terminal 1
cd backend && uvicorn app.main:app --reload --port 8000

# terminal 2
cd frontend && npm install && npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Do not collect HKUST passwords or SIS login. Do not commit files under `data/raw/`.
