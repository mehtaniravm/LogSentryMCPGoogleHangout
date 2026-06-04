# LogSentry — Setup & Operations Guide

A step-by-step guide from **first clone** to **running in production on Google Cloud**.
Written so a beginner can follow it line by line, with expert-level notes called out in
`> **Expert note:**` blocks.

LogSentry is an AI log-monitoring + Q&A system for a fleet of GCP microservices. It has three parts:

1. **MCP server** — read-only tools for log query, service health, and anomaly detection.
2. **AI monitoring agent** — a scheduled loop that inspects logs and decides whether to alert.
3. **Google Chat integration** — pushes proactive alerts and answers questions interactively.

---

## Table of contents

- [Part 0 — Concepts in 60 seconds](#part-0--concepts-in-60-seconds)
- [Part 1 — Prerequisites](#part-1--prerequisites)
- [Part 2 — Local setup](#part-2--local-setup)
- [Part 3 — Local testing (with examples)](#part-3--local-testing-with-examples)
- [Part 4 — Running locally](#part-4--running-locally)
- [Part 5 — Google Cloud setup (step by step)](#part-5--google-cloud-setup-step-by-step)
- [Part 6 — Register the Google Chat bot](#part-6--register-the-google-chat-bot)
- [Part 7 — Verify in production](#part-7--verify-in-production)
- [Part 8 — Configuration reference](#part-8--configuration-reference)
- [Part 9 — Troubleshooting](#part-9--troubleshooting)
- [Part 10 — Cost & safety notes](#part-10--cost--safety-notes)

---

## Part 0 — Concepts in 60 seconds

| Term | What it means here |
|---|---|
| **Cloud Logging** | Where all 90+ microservices already send their logs. |
| **MCP** (Model Context Protocol) | A standard way to expose "tools" an AI model can call. LogSentry exposes 5 read-only tools. |
| **The agent** | Claude, given the MCP tools, asked every few minutes "is anything wrong?" |
| **Thresholds** | Rules in `config/thresholds.yaml` that decide what counts as an anomaly. No code change needed to tune. |
| **Cloud Run** | Serverless container host. LogSentry runs here. Scales to zero when idle. |
| **Cloud Scheduler** | A cron service that pings LogSentry's `/monitor` endpoint on an interval. |

**Everything LogSentry does is read-only.** It can query logs but cannot modify any production system.

---

## Part 1 — Prerequisites

### 1.1 Local tools

| Tool | Version | Check command | Where to get it |
|---|---|---|---|
| Node.js | 20+ (24 works) | `node --version` | https://nodejs.org |
| npm | 10+ | `npm --version` | ships with Node |
| Git | any | `git --version` | https://git-scm.com |
| Bash | any | `bash --version` | macOS/Linux built-in; Windows: Git Bash or WSL |

> **Windows users:** the app and tests run fine in PowerShell. The deploy scripts in `scripts/`
> are Bash — run them from **Git Bash**, **WSL**, or **Cloud Shell** (recommended, see Part 5).

### 1.2 Accounts & keys (only needed for live runs, not for tests)

- **Anthropic API key** — from https://console.anthropic.com (starts with `sk-ant-`).
- **Google Cloud project** — with billing enabled. Note the **Project ID**.
- **Google Chat space** — where alerts post and the bot answers.

> Tests require **none** of these. The entire test suite runs offline with mocked clients.

---

## Part 2 — Local setup

### 2.1 Clone and install

```bash
git clone <your-repo-url> logsentry
cd logsentry
npm install
```

You should see `added NNN packages`. Any `npm audit` warnings are in dev-only tooling
(test runner) and do not ship to production.

### 2.2 Build (compile TypeScript)

```bash
npm run build
```

This runs `tsc` in strict mode. A clean run prints nothing and exits 0. Output goes to `dist/`.

### 2.3 Create your `.env` (only needed to *run* the app, not to test it)

```bash
cp .env.example .env
```

Then open `.env` and fill in real values. Minimum to **run** locally:

```
GCP_PROJECT_ID=your-project-id
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/sa-key.json
```

See [Part 8](#part-8--configuration-reference) for every variable.

> **Expert note:** `src/config/env.ts` validates `.env` with zod at startup. A missing or
> malformed required variable throws a descriptive error listing exactly which var failed —
> the app will not start in a half-configured state.

---

## Part 3 — Local testing (with examples)

**No cloud credentials needed.** All GCP/Anthropic/HTTP calls are mocked.

### 3.1 Run the whole suite

```bash
npm test
```

Expected output (counts may grow):

```
 ✓ test/unit/cards.test.ts (6 tests)
 ✓ test/unit/logging.test.ts (13 tests)
 ✓ test/unit/detectors.test.ts (14 tests)
 ✓ test/unit/thresholds.test.ts (7 tests)
 ✓ test/unit/scoring.test.ts (4 tests)
 ✓ test/unit/env.test.ts (7 tests)
 ✓ test/unit/tools.test.ts (13 tests)
 ✓ test/integration/chat-bot.test.ts (5 tests)
 ✓ test/integration/agent-monitor.test.ts (7 tests)
 ✓ test/integration/mcp-server.test.ts (4 tests)

 Test Files  10 passed (10)
      Tests  80 passed (80)
```

### 3.2 Run one file or watch mode

```bash
npx vitest run test/unit/detectors.test.ts   # one file
npm run test:watch                            # re-run on save
```

### 3.3 Coverage gate

```bash
npm run test:cov
```

This enforces **>85% coverage** on the core modules (`anomaly/`, `mcp/tools/`,
`chat/cards.ts`, `config/`). A passing run exits 0; an HTML report lands in `coverage/`.

### 3.4 What the tests actually prove (examples)

- **Anomaly detection** (`detectors.test.ts`): e.g. 60 logs with 6 errors (10%) over a 5%
  threshold produces an `error_rate` anomaly; the same ratio under `min_volume:50` produces none.
- **Thresholds merge** (`thresholds.test.ts`): `payment-service` inherits global defaults but
  overrides `max_error_pct` to `1.0`.
- **MCP server** (`mcp-server.test.ts`): the server lists exactly 5 tools and each responds over
  an in-memory transport; invalid input returns a structured error, not a crash.
- **Chat bot** (`chat-bot.test.ts`): a question returns a 200 answer card; an unauthenticated
  request returns 401; a malformed payload returns 400; a slow agent returns an async ack.
- **Monitor cycle** (`agent-monitor.test.ts`): `shouldAlert:true` sends exactly one red card;
  the same `service+type` within the cooldown sends only once; malformed model JSON logs an error
  and does **not** alert or crash.

---

## Part 4 — Running locally

These require a real `.env` (Part 2.3). They talk to real services.

### 4.1 Health check + Chat bot (HTTP)

```bash
npm run dev
```

In another terminal:

```bash
# Health
curl -s localhost:8080/health
# -> {"status":"ok"}

# Simulate a Google Chat message (auth is disabled in dev when GOOGLE_CHAT_AUDIENCE is unset)
curl -s -X POST localhost:8080/chat \
  -H 'content-type: application/json' \
  -d '{"type":"MESSAGE","message":{"text":"is payment-service healthy?"}}'
# -> a Google Chat answer card (JSON) mentioning the service
```

> The bot runs Claude with the MCP tools to answer. It needs `ANTHROPIC_API_KEY` and
> read access to your logs (`GOOGLE_APPLICATION_CREDENTIALS`).

### 4.2 MCP server over stdio + Inspector

```bash
# Terminal 1 — start the MCP server on stdio
MCP_TRANSPORT=stdio npm run mcp

# Terminal 2 — open the official MCP Inspector against the built server
npm run build
npx @modelcontextprotocol/inspector node dist/mcp/server.js
```

In the Inspector you should see all **5 tools**: `list_services`, `query_logs`,
`get_service_health`, `find_anomalies`, `get_error_summary`. Invoke each to confirm it responds.

### 4.3 Monitor cycle — safe dry-run against real logs

```bash
# Reads real logs (read-only) but does NOT post to Chat.
DRY_RUN=1 npm run monitor:once
```

The console logs the decision and the alert card it *would* have sent. Flip `DRY_RUN=0`
only when you are ready to post to a real Chat space.

### 4.4 Recommended staged validation order

1. `npm test` green →
2. `npm run test:cov` green →
3. MCP Inspector lists all 5 tools →
4. Bot answers a `curl`'d question →
5. `DRY_RUN=1 npm run monitor:once` produces a sane decision against real logs →
6. Flip `DRY_RUN=0` in a **non-prod** Chat space →
7. Promote to prod.

---

## Part 5 — Google Cloud setup (step by step)

You can run every command from your laptop, but **Cloud Shell** (https://shell.cloud.google.com)
already has `gcloud`, `bq`, and Bash installed — the easiest path for beginners.

> **Always preview first.** Every deploy script supports `DRY_RUN=1`, which prints the exact
> commands instead of executing them. Run with `DRY_RUN=1` first, read the output, then re-run
> without it.

### 5.1 Authenticate and pick your project

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
export GCP_PROJECT_ID=YOUR_PROJECT_ID
export GCP_REGION=us-central1          # or your preferred region
```

### 5.2 Enable the required APIs (one time)

```bash
gcloud services enable \
  logging.googleapis.com \
  bigquery.googleapis.com \
  pubsub.googleapis.com \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  chat.googleapis.com
```

### 5.3 Store secrets in Secret Manager (one time)

The deploy script references these by name; it never inlines secret values.

```bash
# Anthropic API key
printf '%s' 'sk-ant-...' | \
  gcloud secrets create ANTHROPIC_API_KEY --data-file=-

# Google Chat incoming webhook URL (created in Part 6.2; placeholder for now)
printf '%s' 'https://chat.googleapis.com/v1/spaces/XXanXX/messages?key=...&token=...' | \
  gcloud secrets create GOOGLE_CHAT_WEBHOOK_URL --data-file=-
```

To update a secret later:

```bash
printf '%s' 'NEW_VALUE' | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-
```

### 5.4 Run the deploy scripts (in order)

All scripts live in `scripts/` and are **idempotent** (safe to re-run) and **parameterized**
by environment variables. Make them executable once:

```bash
chmod +x scripts/*.sh
```

#### Step 1 — Logging sink (the biggest cost lever)

Creates a BigQuery dataset and a log sink that exports only `severity>=WARNING` to BigQuery,
leaving high-volume INFO/DEBUG in Cloud Logging's cheaper default bucket.

```bash
DRY_RUN=1 bash scripts/01-setup-logging-sink.sh   # preview
bash scripts/01-setup-logging-sink.sh             # execute
```

> After it runs once, it prints the sink's **writer identity** and grants it
> `roles/bigquery.dataEditor`. If you ran it in dry-run, just run it for real and it resolves
> the identity automatically.

#### Step 2 — Pub/Sub real-time path (optional)

Creates a topic and a second sink for near-real-time triggering. The scheduled poll (Step 5)
works fine without this, so skip it if you only want periodic monitoring.

```bash
DRY_RUN=1 bash scripts/02-setup-pubsub.sh
bash scripts/02-setup-pubsub.sh
```

#### Step 3 — BigQuery view

Ensures the dataset/table exist and creates a view that normalizes the exported log schema into
the `LogEntry` shape the app expects.

```bash
DRY_RUN=1 bash scripts/03-setup-bigquery.sh
bash scripts/03-setup-bigquery.sh
```

> **Expert note:** the view's column mapping (`resource.labels.service_name`,
> `jsonPayload.message`, `jsonPayload.latencyMs`, etc.) depends on your org's actual log export
> schema. These spots are marked `VERIFY: schema mapping` in the code and the script — confirm
> them against a real exported row and adjust.

#### Step 4 — Build & deploy to Cloud Run

Creates a **least-privilege runtime service account** (viewer roles only — it literally cannot
modify production), builds the container from source, wires env vars and Secret Manager
references, and deploys.

```bash
DRY_RUN=1 bash scripts/04-deploy-cloudrun.sh
bash scripts/04-deploy-cloudrun.sh
```

The script prints the **service URL** at the end (e.g. `https://logsentry-xxxx.run.app`). Save it.

The runtime SA is granted exactly:
`roles/logging.viewer`, `roles/bigquery.dataViewer`, `roles/bigquery.jobUser` — nothing else.

#### Step 5 — Scheduler (the heartbeat)

Creates a Cloud Scheduler job that calls `POST /monitor` every `MONITOR_INTERVAL_MINUTES`,
authenticated with an OIDC token against the Cloud Run service.

```bash
DRY_RUN=1 bash scripts/05-setup-scheduler.sh
bash scripts/05-setup-scheduler.sh
```

> The script auto-resolves the Cloud Run URL from Step 4. If you run it before deploying, it
> uses a placeholder — just re-run it after the service exists.

### 5.5 Customizing any script

Override defaults via environment variables before running. Common ones:

```bash
export GCP_REGION=europe-west1
export BIGQUERY_DATASET=logsentry
export SERVICE_NAME=logsentry
export MONITOR_INTERVAL_MINUTES=10
export ANTHROPIC_MODEL=claude-opus-4-8     # heavier reasoning
```

See `scripts/common.sh` for the full list of overridable parameters.

---

## Part 6 — Register the Google Chat bot

This is a **one-time, manual** step in the Google Cloud Console UI (no script).

### 6.1 Configure the bot endpoint (for interactive Q&A)

1. Go to **Google Cloud Console → APIs & Services → Google Chat API → Configuration**.
2. **App name / Avatar / Description:** fill in (e.g. "LogSentry").
3. **Functionality:** enable "Receive 1:1 messages" and "Join spaces and group conversations".
4. **Connection settings:** choose **HTTP endpoint URL** and set it to:
   `https://<your-cloud-run-url>/chat`
5. **Authentication audience:** set to your bot's project number, and put the same value in the
   `GOOGLE_CHAT_AUDIENCE` env var so the bot verifies inbound calls.
6. Save, then **add the bot to your support space** (`@LogSentry` in the space, or invite it).

### 6.2 Create the incoming webhook (for proactive alerts)

1. Open the target Chat **space → Manage webhooks** (Apps & integrations).
2. Create a webhook named "LogSentry Alerts" and copy its URL.
3. Put that URL in Secret Manager as `GOOGLE_CHAT_WEBHOOK_URL` (Part 5.3) and redeploy if needed:
   ```bash
   printf '%s' 'PASTE_WEBHOOK_URL' | \
     gcloud secrets versions add GOOGLE_CHAT_WEBHOOK_URL --data-file=-
   bash scripts/04-deploy-cloudrun.sh
   ```

---

## Part 7 — Verify in production

```bash
SERVICE_URL=$(gcloud run services describe logsentry \
  --region="$GCP_REGION" --format='value(status.url)')

# 1) Health (requires an identity token since the service is not public)
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$SERVICE_URL/health"
# -> {"status":"ok"}
```

2. **Ask a question** in the Chat space (e.g. "is payment-service healthy?") → the bot answers.
3. **Force an alert** to confirm the proactive path: temporarily lower a threshold in
   `config/thresholds.yaml` (e.g. `max_error_pct: 0.1`), redeploy with
   `bash scripts/04-deploy-cloudrun.sh`, wait one scheduler interval, confirm an alert posts, then
   restore the threshold and redeploy.
4. **Manually trigger a cycle** (instead of waiting for the scheduler):
   ```bash
   gcloud scheduler jobs run logsentry-monitor --location="$GCP_REGION"
   ```

---

## Part 8 — Configuration reference

### 8.1 Environment variables (`.env` locally / env+secrets on Cloud Run)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GCP_PROJECT_ID` | ✅ | — | GCP project hosting logs/BigQuery. |
| `GOOGLE_APPLICATION_CREDENTIALS` | local only | — | Path to a viewer-only SA key JSON. On Cloud Run the runtime SA is used automatically. |
| `BIGQUERY_DATASET` | — | `logsentry` | Dataset for exported logs. |
| `BIGQUERY_LOGS_TABLE` | — | `app_logs` | Logs table/prefix. |
| `ANTHROPIC_API_KEY` | ✅ | — | Claude API key. |
| `ANTHROPIC_MODEL` | — | `claude-sonnet-4-6` | Model id. Use `claude-opus-4-8` for heavier reasoning. |
| `GOOGLE_CHAT_WEBHOOK_URL` | for alerts | — | Incoming webhook for proactive alerts. |
| `GOOGLE_CHAT_AUDIENCE` | for bot auth | — | Bot project number; enables inbound auth verification. |
| `MONITOR_INTERVAL_MINUTES` | — | `5` | How often the scheduler triggers a cycle. |
| `DEFAULT_WINDOW_MINUTES` | — | `5` | Look-back window for health/anomaly queries. |
| `ALERT_COOLDOWN_MINUTES` | — | `30` | Suppress re-alerting the same `service+type` within this window. |
| `MAX_LOGS_PER_QUERY` | — | `500` | Hard cap on logs fetched per query (cost guard). |
| `PORT` | — | `8080` | HTTP port. |
| `MCP_TRANSPORT` | — | `http` | `http` (Cloud Run) or `stdio` (local/Inspector). |
| `LOG_LEVEL` | — | `info` | `debug`/`info`/`warn`/`error`. |
| `DRY_RUN` | — | `0` | `1` = scripts echo instead of execute; monitor logs instead of posting. |

### 8.2 Anomaly thresholds — `config/thresholds.yaml`

All sensitivity lives here; **no thresholds are hardcoded**. Edit, redeploy, done.

- `defaults:` apply to every service (`error_rate`, `latency`, `error_burst`, `fatal`,
  `silence`, `severity_weights`).
- `services:` override specific fields per service. Example (already in the file):

```yaml
services:
  payment-service:
    error_rate:
      max_error_pct: 1.0   # stricter for money paths
    fatal:
      max_fatal: 0         # any FATAL alerts
  batch-report-service:
    silence:
      window_minutes: 360  # batch jobs are quiet by design
```

A service not listed under `services:` uses pure defaults. Overrides are **field-level** — you
only specify what differs.

---

## Part 9 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run build` errors about missing types | deps not installed | `npm install` |
| Tests fail with cloud/credential errors | shouldn't happen — tests are mocked | ensure you're on a clean checkout; run `npm install` |
| App exits at startup with "Invalid environment configuration" | missing/invalid `.env` var | read the error — it names the exact variable |
| Bot returns 401 | `GOOGLE_CHAT_AUDIENCE` set but request lacks a valid bearer token | confirm the Chat API audience matches; in dev, unset the audience to disable auth |
| Bot returns 400 | payload isn't a Chat `MESSAGE` with text | send `{"type":"MESSAGE","message":{"text":"..."}}` |
| No alerts ever fire | thresholds too lax, or `DRY_RUN=1`, or webhook unset | lower a threshold to test; check `GOOGLE_CHAT_WEBHOOK_URL`; set `DRY_RUN=0` |
| Duplicate-looking alerts suppressed | cooldown working as intended | tune `ALERT_COOLDOWN_MINUTES` |
| `find_anomalies` returns nothing on real logs | service-label key mismatch | check the `VERIFY: schema mapping` spots; confirm `resource.labels` carries your service name |
| Scheduler job 403s the service | OIDC audience/SA mismatch | re-run `scripts/05-setup-scheduler.sh` after the service URL exists |
| BigQuery view returns wrong columns | export schema differs from assumed shape | adjust the view SQL in `scripts/03-setup-bigquery.sh` |

Useful inspection commands:

```bash
gcloud run services logs read logsentry --region="$GCP_REGION" --limit=50
gcloud scheduler jobs describe logsentry-monitor --location="$GCP_REGION"
gcloud logging sinks describe logsentry-warn-sink
bq show "$GCP_PROJECT_ID:logsentry"
```

---

## Part 10 — Cost & safety notes

LogSentry is built to **not impact customers** and to **keep logging costs bounded**:

1. **Read-only everywhere.** No tool, query, or script writes to production. BigQuery access is
   guarded by `assertReadOnly` (rejects INSERT/UPDATE/DELETE/MERGE/DROP/CREATE/ALTER/TRUNCATE);
   MCP tools have no mutation handlers.
2. **Least-privilege service account.** The Cloud Run runtime SA holds only `logging.viewer`,
   `bigquery.dataViewer`, `bigquery.jobUser`. It cannot harm production.
3. **Query caps.** `query_logs` hard-caps at `MAX_LOGS_PER_QUERY` (500) and windows at 24h.
4. **Log tiering** (Step 1). Only `severity>=WARNING` is exported to BigQuery; INFO/DEBUG stay in
   the cheaper default bucket. At 90 services this is the single biggest cost lever.
5. **Alert dedup + cooldown** prevents alert storms (which themselves cost API calls and human
   attention).
6. **Sampling option:** if INFO volume is still high, sample at the log4j appender level — see the
   note in the README.

> **Golden rule:** preview every cloud-mutating script with `DRY_RUN=1` before running it for real.
```
