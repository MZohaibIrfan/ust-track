# UST Track

FastAPI + React + Supabase Postgres. Framework only — do not assume Next.js, Prisma, SQLite, Docker Compose, or Qdrant.

- API lives in `backend/app/api`. Routes are stubs.
- Models live in `backend/app/models` (`catalog` and `planner` schemas).
- Ingestion and services are stubs in `backend/app/ingestion` and `backend/app/services`.
- Web app lives in `frontend/`. Vite proxies `/api` to FastAPI.
- Official HTML/PDFs go in `data/raw/` and are not committed.
- An LLM advisor will later draft timetables and degree plans from Postgres data. Do not implement it unless asked.
