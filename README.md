# UST Track

Degree, timetable, and career planning for HKUST undergraduates.

> **⚠️ Work in progress.** This is an active hackathon project — pages, agents, and data are still being built out and can change or break without notice. Nothing here is production-ready.

## What's here

- **Overview** — dashboard summary of your plan.
- **Timetable** — weekly calendar of enrolled sections, conflict checking, ICS export, and a chat agent that can search/add/drop classes.
- **Degree** — declared programs, requirement-tree progress, an editable multi-year study plan, and a chat agent that can declare programs and rearrange the plan.
- **Career** — logged internships/projects/research/extracurriculars, a deterministic job-description-to-course matcher, and a one-click LaTeX/PDF CV generator (Jake's Resume template) with per-CV include/exclude selection and generation history.
- **Auth & onboarding** — email/password accounts with a guided setup flow.

Each agent chat is grounded in real Postgres data (catalog + the student's own planner rows) rather than the model's general knowledge, and persists its own conversation history per page.

## Stack

- **Web:** React + Vite + TypeScript + Tailwind
- **API:** FastAPI under `/api`
- **Database:** Supabase Postgres (`catalog` and `planner` schemas), via the session pooler in `DATABASE_URL`
- **Agents:** OpenRouter-backed chat agents (per page) that call deterministic backend tools rather than reasoning over catalog data themselves
- **PDF generation:** shells out to a local `pdflatex` install for the CV builder

## Layout

```text
backend/                 FastAPI, SQLAlchemy 2, Alembic
  app/models/            catalog + planner + auth tables
  app/services/          degree/timetable/career ops, study plans, CV generation
  app/services/agents/   per-page chat agents (degree, timetable, career)
  app/api/               routes
frontend/                Vite + React app
  src/pages/             Overview, Timetable, Degree, Career, History, Profile, Login/Onboarding
data/raw/                official HTML + PDFs (gitignored)
```

## Setup

```bash
cp .env.example .env
# fill in DATABASE_URL, SECRET_KEY, and OPENROUTER_API_KEY

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

The CV builder's PDF export needs a local `pdflatex` (e.g. MacTeX/TeXLive) — without it, generating the `.tex` file still works, just not the inline PDF preview.

Do not collect HKUST passwords or SIS login. Do not commit files under `data/raw/`.
