# RivalPulse Competitor Intelligence

Product-style monorepo for competitor website monitoring, analyst review, and recurring intelligence reports.

Primary user flow:
- `Setup`: connect competitors and the pages to monitor
- `Overview`: see what changed and what needs attention
- `Output Builder`: choose approved changes and generate exportable outputs

Current runtime:
- `web`: React frontend served by Nginx
- `api`: FastAPI backend with session auth and JSON APIs
- `worker`: background crawl/report loop
- `db`: PostgreSQL in Docker

Verified locally:
- `docker compose up --build -d`
- `web` reachable at `http://localhost:3410`
- `api` reachable at `http://localhost:8410`
- `db` reachable at `localhost:55432`

## Ports

This stack intentionally avoids common local conflicts:

- Web app: `3410`
- API: `8410`
- PostgreSQL: `55432`

Known conflicting local ports observed on this machine and avoided:
- `3000`
- `5432`
- `8000`

## Quick Start With Docker

1. Create a local environment file:

```powershell
Copy-Item .env.example .env
```

2. Edit `.env` and set at least `APP_SECRET_KEY`, `DEFAULT_ADMIN_EMAIL`, and `DEFAULT_ADMIN_PASSWORD`. Add `OPENAI_API_KEY` only if you want live GPT classification/reporting.
3. Run `docker compose up --build -d`
4. Open `http://localhost:3410`
5. Login with the admin account configured in `.env`

Useful commands:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f web api worker
docker compose down
```

To remove containers and named volumes completely:

```powershell
docker compose down -v
```

## Repo structure

```text
/apps
  /api
    /src/competitor_intel
      /api/routes        # HTTP routes by module
      /services          # crawl, diff, classify, reports
      models.py          # SQLAlchemy models
      worker.py          # background scheduler/processor
  /web
    /src/app            # auth, app shell, routing
    /src/components     # shared UI/layout pieces
data/                   # generated local storage, ignored by git
```

## Module boundaries

- `apps/web`: user-facing web product
- `apps/api/src/competitor_intel/api/routes`: backend endpoints grouped by business module
- `apps/api/src/competitor_intel/services`: crawler, diff engine, classifier, review, dashboard, reports
- `apps/api/src/competitor_intel/worker.py`: scheduled processing loop
- `docker-compose.yml`: packaged runtime for local development and deployment trials

## Local Dev Without Docker

Backend:

```powershell
$env:PYTHONPATH="apps/api/src"
$env:DATABASE_URL="sqlite:///./data/dev.db"
python -m competitor_intel.cli bootstrap
uvicorn competitor_intel.main:app --host 0.0.0.0 --port 8410
python -m competitor_intel.worker
```

Frontend:

```powershell
cd apps/web
npm install
npm run dev
```

## Admin Account

The bootstrap command creates one admin account from `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` in `.env`.

## PostgreSQL in Docker

PostgreSQL is included in `docker-compose.yml`.

- Host: `localhost`
- Port: `55432`
- Database: `rivalpulse_ci`
- User: `app`
- Password: `app`

Connection string from host tools:

```text
postgresql://app:app@localhost:55432/rivalpulse_ci
```

## Capabilities included

- Competitor and source registry
- Scheduled and manual crawl jobs
- HTML snapshotting to local object storage
- Diff detection with OpenAI-backed classification when `OPENAI_API_KEY` is configured
- Heuristic fallback classification when GPT is unavailable
- Analyst review workflow
- React dashboard, competitors, sources, events, reports UI
- GPT-assisted report synthesis with heuristic fallback
- Report HTML rendering and PDF export

## Notes

- Storage defaults to local filesystem for a lower-friction MVP runtime
- By default the app runs in heuristic fallback mode until `OPENAI_API_KEY` is set in `.env`
- Competitors and monitored sources are created from the app UI; no demo competitor data is seeded by default
- The default AI split is `OPENAI_EVENT_MODEL=gpt-4o-mini`, `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`, and `OPENAI_ASK_MODEL` / `OPENAI_REPORT_MODEL` on `gpt-4o`
- The dashboard and topbar expose whether the app is using live GPT or fallback mode
- Docker packaging was validated locally with:
  - `docker compose up --build -d`
  - `docker compose ps`
  - `GET /health/live`
  - `GET /`
  - `GET /api/auth/me` returning `401` before login
