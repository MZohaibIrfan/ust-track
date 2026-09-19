# UST Track

Degree and timetable planning for HKUST undergraduates, built on structured course data —
plus an advisor agent that reads that same data to help plan a pathway.

## Stack

- **App:** Next.js (App Router) + TypeScript + Tailwind
- **API:** Next.js route handlers in the same app (`/api/courses`, `/api/programs`, `/api/advisor`)
- **Database:** SQLite via Prisma
- **Advisor:** OpenRouter (OpenAI-compatible chat API), with tools that query and write to
  the Prisma schema — no separate memory of the catalog, it always looks courses up

A separate Python backend is not needed yet. When we ingest class quota / catalog pages, that can be a script that writes into this schema.

## Setup

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `OPENROUTER_API_KEY` in `.env` to enable `/advisor`. Change `OPENROUTER_MODEL` to pick a
different OpenRouter slug (default `openai/gpt-4.1-mini`). The rest of the app works without it.
