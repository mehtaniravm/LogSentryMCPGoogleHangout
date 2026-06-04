# LogSentry — Complete Build Specification for Claude Code

> **How to use this document:** Paste this entire file into Claude Code (or place it at the repo root as `BUILD_SPEC.md` and tell Claude Code "build the system described in BUILD_SPEC.md, one phase at a time, running tests after each phase"). It is self-contained: architecture, file tree, full requirements, test cases, and deployment steps. Build **phase by phase** and do not advance until the phase's tests pass.

---

## 0. What you are building (one paragraph)

LogSentry is an AI-powered, centralized log-monitoring and Q&A system for a fleet of 90+ Java (log4j) microservices running on Google Cloud Platform. All services already ship logs to **Google Cloud Logging**. LogSentry adds: (1) an **MCP server** that exposes log-query, health, and anomaly-detection tools; (2) an **AI monitoring agent** that periodically inspects logs via those tools and decides whether to raise an alert; (3) a **Google Chat integration** that both *pushes* proactive alerts and *answers* support questions interactively by calling the same MCP tools. Anomaly thresholds are fully parameter-driven (config file + env), so no code changes are needed to tune sensitivity.

---

## 1. Tech stack (use exactly this unless a test forces otherwise)

| Layer | Choice | Reason |
|---|---|---|
| Language | **TypeScript (Node.js 20)** | First-class MCP SDK, easy Cloud Run deploy |
| MCP server | `@modelcontextprotocol/sdk` | Official MCP implementation |
| Log source | `@google-cloud/logging` + `@google-cloud/bigquery` | Native GCP access |
| Streaming | `@google-cloud/pubsub` | Real-time log fan-out to the agent |
| AI agent | `@anthropic-ai/sdk` (Claude) | Reasoning over log windows |
| Chat | Google Chat REST API + incoming webhook | Already enabled in the org |
| HTTP | `express` | Chat bot endpoint + health checks |
| Config/validation | `zod` + `dotenv` | Typed, validated, parameterized config |
| Test | `vitest` + `nock` (HTTP mocks) | Fast, TS-native, good mocking |
| Deploy | **Cloud Run** + Cloud Scheduler | Serverless, scale-to-zero |
| IaC | `gcloud` scripts (provided) + optional Terraform | Beginner-friendly first |

---

## 2. Repository file tree (create exactly this)

```
logsentry/
├── BUILD_SPEC.md                  # this file
├── README.md                      # generated in Phase 0
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gcloudignore
├── Dockerfile
├── config/
│   └── thresholds.yaml            # parameterized anomaly rules
├── src/
│   ├── config/
│   │   ├── env.ts                 # zod-validated env
│   │   └── thresholds.ts          # loads + validates thresholds.yaml
│   ├── logging/
│   │   ├── cloudLogging.ts        # query Cloud Logging
│   │   ├── bigquery.ts            # historical queries
│   │   └── types.ts               # LogEntry, ServiceHealth, etc.
│   ├── anomaly/
│   │   ├── detectors.ts           # rule-based detectors
│   │   └── scoring.ts             # severity scoring
│   ├── mcp/
│   │   ├── server.ts              # MCP server bootstrap
│   │   └── tools/
│   │       ├── queryLogs.ts
│   │       ├── getServiceHealth.ts
│   │       ├── findAnomalies.ts
│   │       ├── getErrorSummary.ts
│   │       └── listServices.ts
│   ├── agent/
│   │   ├── monitor.ts             # scheduled AI monitoring loop
│   │   └── prompt.ts              # system prompt for the agent
│   ├── chat/
│   │   ├── webhook.ts             # outbound alert sender
│   │   ├── bot.ts                 # inbound Q&A handler (express route)
│   │   └── cards.ts               # Google Chat card formatting
│   ├── server.ts                  # express app (bot + health + MCP mount)
│   └── index.ts                   # entrypoint
├── scripts/
│   ├── 01-setup-logging-sink.sh
│   ├── 02-setup-pubsub.sh
│   ├── 03-setup-bigquery.sh
│   ├── 04-deploy-cloudrun.sh
│   └── 05-setup-scheduler.sh
└── test/
    ├── unit/
    │   ├── thresholds.test.ts
    │   ├── detectors.test.ts
    │   ├── scoring.test.ts
    │   ├── cards.test.ts
    │   └── tools.test.ts
    ├── integration/
    │   ├── mcp-server.test.ts
    │   ├── chat-bot.test.ts
    │   └── agent-monitor.test.ts
    └── fixtures/
        ├── logEntries.ts
        └── chatMessages.ts
```

---

## 3. Build phases (Claude Code: implement in this order)

### Phase 0 — Scaffold
- Initialize `package.json`, `tsconfig.json` (strict mode), `vitest.config.ts`.
- Create `.env.example` (see §6), `.gcloudignore`, `Dockerfile`.
- Generate `README.md` summarizing setup.
- **Gate:** `npm install` succeeds, `npm run build` (tsc) passes with zero files yet failing.

### Phase 1 — Config & types
- Implement `src/config/env.ts` (zod schema validating all env vars from §6).
- Implement `config/thresholds.yaml` + `src/config/thresholds.ts` loader/validator.
- Implement `src/logging/types.ts`.
- **Gate:** `thresholds.test.ts` passes (see §5).

### Phase 2 — Log access layer
- Implement `cloudLogging.ts` and `bigquery.ts`. Both must accept an injectable client so tests can mock.
- **Gate:** unit tests with mocked GCP clients pass.

### Phase 3 — Anomaly engine
- Implement `detectors.ts` (rules below) and `scoring.ts`.
- **Gate:** `detectors.test.ts`, `scoring.test.ts` pass.

### Phase 4 — MCP server + tools
- Implement all 5 tools and `mcp/server.ts`.
- **Gate:** `mcp-server.test.ts` (lists tools, invokes each with mocked log layer) passes.

### Phase 5 — Google Chat
- Implement `cards.ts`, `webhook.ts`, `bot.ts`.
- **Gate:** `cards.test.ts`, `chat-bot.test.ts` pass.

### Phase 6 — AI agent
- Implement `agent/prompt.ts` and `agent/monitor.ts`. Agent calls MCP tools, decides alert/no-alert, sends via webhook.
- **Gate:** `agent-monitor.test.ts` (mocked Anthropic + mocked tools) passes.

### Phase 7 — Wire-up & server
- Implement `server.ts` and `index.ts` (express: `/health`, `/chat` bot route, mount MCP over HTTP transport).
- **Gate:** full `npm test` green; `npm run build` clean.

### Phase 8 — Deployment scripts
- Implement all `scripts/*.sh`. Make idempotent and parameterized by env vars.
- **Gate:** `bash -n` syntax check on each script passes; dry-run echo mode supported via `DRY_RUN=1`.

---

## 4. Detailed component requirements

### 4.1 Configurable thresholds — `config/thresholds.yaml`

All anomaly sensitivity is here. The agent and detectors read this; **no thresholds are hardcoded.**

```yaml
# Global defaults applied to every service unless overridden
defaults:
  error_rate:
    window_minutes: 5          # look-back window
    max_error_pct: 5.0         # alert if >5% of logs are ERROR/FATAL
    min_volume: 50             # ignore windows with fewer than N logs (noise guard)
  latency:
    window_minutes: 5
    p99_ms_threshold: 2000     # alert if p99 latency > 2s (requires latency in log payload)
  error_burst:
    window_minutes: 1
    max_errors: 100            # absolute error count spike
  fatal:
    window_minutes: 5
    max_fatal: 1               # any FATAL is alert-worthy
  silence:
    expected_min_logs: 1       # alert if a normally-chatty service goes silent
    window_minutes: 10
  severity_weights:            # feeds scoring.ts
    FATAL: 100
    ERROR: 10
    WARN: 2

# Per-service overrides (optional). Keys are the Cloud Logging resource label.
services:
  payment-service:
    error_rate:
      max_error_pct: 1.0       # stricter for money paths
    fatal:
      max_fatal: 0
  batch-report-service:
    silence:
      window_minutes: 360      # batch jobs are quiet by design
```

`thresholds.ts` must: load YAML, validate with zod, expose `getThresholdsForService(serviceName)` that merges defaults + per-service overrides, and throw a clear error on malformed config.

### 4.2 Log access — `src/logging/`

`cloudLogging.ts` exports:
- `queryLogs(opts: { service?: string; minSeverity?: Severity; windowMinutes: number; limit?: number; textFilter?: string }): Promise<LogEntry[]>` — builds a Cloud Logging advanced filter string and pages results.
- `listServices(): Promise<string[]>` — distinct `resource.labels` service names seen in the last 24h.

`bigquery.ts` exports:
- `queryHistorical(sql: string, params): Promise<Row[]>` — parameterized, read-only. Reject any SQL containing DML keywords (INSERT/UPDATE/DELETE/MERGE/DROP/CREATE/ALTER) via a guard function `assertReadOnly(sql)`.

Both modules take the GCP client via constructor/factory injection so tests pass a fake.

`types.ts`:
```ts
export type Severity = 'DEBUG'|'INFO'|'NOTICE'|'WARN'|'ERROR'|'CRITICAL'|'ALERT'|'FATAL';
export interface LogEntry {
  timestamp: string;        // ISO
  service: string;
  severity: Severity;
  message: string;
  traceId?: string;
  latencyMs?: number;
  labels?: Record<string,string>;
}
export interface ServiceHealth {
  service: string;
  windowMinutes: number;
  totalLogs: number;
  errorCount: number;
  fatalCount: number;
  errorPct: number;
  p99LatencyMs?: number;
  status: 'healthy'|'degraded'|'critical'|'silent';
}
export interface Anomaly {
  service: string;
  type: 'error_rate'|'latency'|'error_burst'|'fatal'|'silence';
  detail: string;
  observed: number;
  threshold: number;
  severityScore: number;     // from scoring.ts
  sampleMessages: string[];  // up to 3 representative log lines
}
```

### 4.3 Anomaly engine — `src/anomaly/`

`detectors.ts` exports pure functions (easy to test, no I/O):
- `detectErrorRate(entries, th): Anomaly | null`
- `detectLatency(entries, th): Anomaly | null`
- `detectErrorBurst(entries, th): Anomaly | null`
- `detectFatal(entries, th): Anomaly | null`
- `detectSilence(entries, th): Anomaly | null`
- `runAllDetectors(entries, th): Anomaly[]`

Rules (each respects `min_volume` / window from thresholds):
- **error_rate**: `errorCount / total > max_error_pct/100` AND `total >= min_volume`.
- **latency**: compute p99 of `latencyMs` present entries; alert if `> p99_ms_threshold`.
- **error_burst**: `errorCount >= max_errors` within window.
- **fatal**: `fatalCount > max_fatal`.
- **silence**: `total < expected_min_logs` over window → service may be down.

`scoring.ts`:
- `scoreAnomaly(a, weights): number` — weighted score; higher = more urgent. Used to sort and to decide Chat card color (see cards.ts). Deterministic and unit-tested.

### 4.4 MCP tools — `src/mcp/tools/`

Each tool: name, description, zod input schema, handler. Tools are **read-only** (the system never mutates production). Tools:

1. **`list_services`** → `{}` → returns string[] of service names. Wraps `listServices()`.
2. **`query_logs`** → `{ service?, minSeverity?, windowMinutes (1-1440), limit? (<=500), textFilter? }` → returns LogEntry[]. Caps limit at 500 to protect cost/latency.
3. **`get_service_health`** → `{ service, windowMinutes? }` → computes ServiceHealth from a log query.
4. **`find_anomalies`** → `{ service?, windowMinutes? }` → runs detectors across one or all services; returns Anomaly[] sorted by severityScore desc.
5. **`get_error_summary`** → `{ service?, windowMinutes? }` → groups ERROR/FATAL messages, returns top error signatures with counts (normalize messages by stripping digits/UUIDs to cluster similar errors).

`server.ts` registers all tools and supports two transports: **stdio** (local dev / Claude Desktop) and **HTTP/SSE** (Cloud Run). Pick transport by `MCP_TRANSPORT` env.

### 4.5 Google Chat — `src/chat/`

`cards.ts`:
- `buildAlertCard(anomalies: Anomaly[]): ChatCard` — header colored by max severityScore (green/amber/red), one section per anomaly with service, type, observed vs threshold, and up to 3 sample log lines, plus a "View in Cloud Logging" button (deep link URL built from service + time window).
- `buildAnswerCard(question: string, answer: string, sources: string[]): ChatCard`.

`webhook.ts`:
- `sendAlert(card): Promise<void>` — POST to `GOOGLE_CHAT_WEBHOOK_URL`. Retry 3x with exponential backoff. Dedup: maintain an in-memory (and optionally Firestore) suppression map so the same `service+type` isn't re-alerted within `ALERT_COOLDOWN_MINUTES`.

`bot.ts` (express handler at `POST /chat`):
- Verify the request is from Google Chat (check bearer token / audience per Google Chat bot auth).
- Parse the user message text.
- Run it through Claude with the MCP tools available (the bot is itself an agent turn): Claude decides which tools to call to answer "is payment-service having issues?" etc.
- Reply with `buildAnswerCard`. Must respond within Google Chat's ~30s sync window; if longer, return an async ack and post follow-up.

### 4.6 AI agent — `src/agent/`

`prompt.ts` — system prompt instructing Claude to: inspect recent logs via tools, identify genuine anomalies (not transient noise), avoid alert fatigue, and only escalate issues that meet threshold config. Must instruct: never invent services or numbers; only report what tools return; prefer one consolidated alert over many.

`monitor.ts` — `runMonitorCycle()`:
1. Load thresholds.
2. Ask Claude (with MCP tools) to assess fleet health for the configured window.
3. Claude returns a structured decision: `{ shouldAlert: boolean, anomalies: Anomaly[], summary: string }` (enforce JSON-only output, parse safely).
4. If `shouldAlert`, build card + `sendAlert` (respecting cooldown/dedup).
5. Log the cycle outcome for audit.

Invoked by Cloud Scheduler hitting `POST /monitor` (or as a separate Cloud Run job) every `MONITOR_INTERVAL_MINUTES`.

---

## 5. Test cases (Claude Code: generate these as real, passing tests)

Use `vitest`. Mock all GCP/Anthropic/HTTP I/O — **tests must run with zero cloud credentials**. Aim for >85% line coverage on `anomaly/`, `mcp/tools/`, `chat/cards.ts`, `config/`.

### 5.1 Unit — `thresholds.test.ts`
- loads valid YAML without throwing.
- `getThresholdsForService('payment-service')` returns merged config where `max_error_pct === 1.0` (override) but inherits default `latency.p99_ms_threshold`.
- unknown service returns pure defaults.
- malformed YAML (missing required field) throws a descriptive error.

### 5.2 Unit — `detectors.test.ts` (use `fixtures/logEntries.ts`)
- `detectErrorRate`: 60 logs, 6 ERROR (10%) with `max_error_pct:5` → returns anomaly with `observed≈10, threshold:5`.
- error_rate respects `min_volume`: 10 logs, 5 ERROR (50%) but `min_volume:50` → returns `null`.
- `detectFatal`: 1 FATAL with `max_fatal:0` → anomaly; with `max_fatal:1` → null.
- `detectErrorBurst`: 120 errors in window, `max_errors:100` → anomaly.
- `detectLatency`: entries with latency [100,...,5000], `p99_ms_threshold:2000` → anomaly; all <2000 → null.
- `detectSilence`: 0 logs, `expected_min_logs:1` → anomaly (status silent).
- `runAllDetectors`: mixed fixture returns the expected set, no duplicates.

### 5.3 Unit — `scoring.test.ts`
- FATAL anomaly scores higher than ERROR anomaly with same counts.
- scoring is deterministic (same input → same output).
- higher observed/threshold ratio → higher score within same type.

### 5.4 Unit — `cards.test.ts`
- `buildAlertCard` with a critical anomaly → header color red; contains service name, observed vs threshold, ≤3 sample lines.
- multiple anomalies → one section each, ordered by severityScore desc.
- "View in Cloud Logging" button URL contains the service and an encoded time range.
- `buildAnswerCard` renders question + answer + sources.

### 5.5 Unit — `tools.test.ts` (mock the log layer)
- `query_logs` rejects `limit > 500` (zod validation error) and `windowMinutes > 1440`.
- `get_service_health` computes `errorPct` correctly and sets `status` per thresholds.
- `find_anomalies` returns sorted-desc by severityScore.
- `get_error_summary` clusters `"NPE at line 42"` and `"NPE at line 87"` into one normalized signature with count 2.
- `bigquery.assertReadOnly` throws on `DELETE FROM ...` and passes on `SELECT ...`.

### 5.6 Integration — `mcp-server.test.ts`
- server lists exactly 5 tools with correct names/schemas.
- invoking each tool over the in-memory transport with a mocked log layer returns well-formed results.
- invalid tool input returns a structured MCP error, not a crash.

### 5.7 Integration — `chat-bot.test.ts` (use `fixtures/chatMessages.ts`, mock Anthropic + tools with nock)
- POST `/chat` with "is payment-service healthy?" → 200, response card mentions payment-service.
- unauthenticated request (bad/missing token) → 401.
- malformed payload → 400, no crash.
- slow downstream → bot still returns within timeout (async ack path).

### 5.8 Integration — `agent-monitor.test.ts` (mock Anthropic returning a decision JSON)
- when mocked Claude returns `shouldAlert:true` with one anomaly → `sendAlert` (mocked webhook) called once with a red card.
- when `shouldAlert:false` → webhook NOT called.
- cooldown: two cycles with the same `service+type` inside `ALERT_COOLDOWN_MINUTES` → webhook called only once.
- malformed Claude output (non-JSON) → cycle logs error, does not crash, does not alert.

### 5.9 Coverage / CI gate
- `npm test` runs all suites; `npm run test:cov` enforces thresholds. Add a `ci` script chaining `build` + `test:cov`.

---

## 6. Environment variables — `.env.example`

```
# GCP
GCP_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json   # local only; on Cloud Run use the runtime SA
BIGQUERY_DATASET=logsentry
BIGQUERY_LOGS_TABLE=app_logs

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Google Chat
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/XXXX/messages?key=...&token=...
GOOGLE_CHAT_AUDIENCE=your-bot-project-number          # for verifying inbound bot calls

# Behavior (parameterized)
MONITOR_INTERVAL_MINUTES=5
DEFAULT_WINDOW_MINUTES=5
ALERT_COOLDOWN_MINUTES=30
MAX_LOGS_PER_QUERY=500

# Runtime
PORT=8080
MCP_TRANSPORT=http        # http | stdio
LOG_LEVEL=info
DRY_RUN=0                 # 1 = scripts echo instead of execute
```

---

## 7. Cost & customer-safety guardrails (implement, don't just document)

These directly answer "don't impact customers and optimize logs":

1. **Read-only everywhere.** No tool, query, or script writes to production systems. `assertReadOnly` guards BigQuery; MCP tools have no mutation handlers.
2. **Query caps.** `query_logs` hard-caps at `MAX_LOGS_PER_QUERY` and windows at 24h to bound Cloud Logging / BigQuery cost.
3. **Log tiering (in deploy scripts).** The logging sink (`01-setup-logging-sink.sh`) routes only `severity >= WARNING` to BigQuery; INFO/DEBUG stay in Cloud Logging's cheaper default bucket with a short retention. This is the single biggest cost lever at 90 services.
4. **Log-based metrics** for high-frequency counters (error counts) instead of scanning raw logs every cycle — the agent reads the metric, not millions of rows.
5. **Alert dedup + cooldown** to prevent alert storms (which themselves cause API cost and human fatigue).
6. **Sampling note:** document in README that ultra-chatty INFO logs can be sampled at the log4j appender level if volume becomes a problem.
7. **Separate, least-privilege service account**: `roles/logging.viewer`, `roles/bigquery.dataViewer`, `roles/bigquery.jobUser` only. No editor/owner. The agent literally cannot harm production.

---

## 8. Step-by-step testing guide (run after Claude Code builds each phase)

**Local, no cloud needed:**
```bash
npm install
npm run build           # tsc strict, must be clean
npm test                # all unit + integration (mocked)
npm run test:cov        # coverage gate >85% on core modules
```

**Local MCP smoke test (stdio):**
```bash
MCP_TRANSPORT=stdio npm run mcp
# In another terminal, use the MCP Inspector:
npx @modelcontextprotocol/inspector node dist/mcp/server.js
# Verify all 5 tools list and respond.
```

**Local Chat bot test:**
```bash
npm run dev             # express on :8080
curl -s localhost:8080/health        # -> {"status":"ok"}
# Simulate a Chat message (auth disabled in dev):
curl -s -X POST localhost:8080/chat -H 'content-type: application/json' \
  -d '{"type":"MESSAGE","message":{"text":"is payment-service healthy?"}}'
```

**Agent dry-run against real GCP (read-only, safe):**
```bash
# With real SA key that has ONLY viewer roles:
DRY_RUN=1 npm run monitor:once     # logs the decision + would-send card, but does NOT post to Chat
```

**Staged validation order:**
1. Unit tests green → 2. Integration green → 3. MCP Inspector shows tools → 4. Bot answers a curl'd question → 5. Monitor dry-run produces a sane decision against real logs → 6. Flip `DRY_RUN=0` in a non-prod Chat space → 7. Promote.

---

## 9. Step-by-step deployment guide (scripts do the work; here's the order + what each does)

> Prereqs: `gcloud` installed and authenticated; project set: `gcloud config set project $GCP_PROJECT_ID`. Run scripts with `DRY_RUN=1` first to preview.

**Step 1 — Logging sink (cost-optimized routing)** — `scripts/01-setup-logging-sink.sh`
Creates a BigQuery dataset and a log sink that exports `severity>=WARNING` to BigQuery, leaving high-volume INFO/DEBUG in the default bucket. Grants the sink's writer identity BigQuery dataEditor on the dataset.

**Step 2 — Pub/Sub (real-time path)** — `scripts/02-setup-pubsub.sh`
Creates a topic `logsentry-stream` and a second sink exporting WARNING+ to it, for near-real-time agent triggering (optional; the scheduled poll works without it).

**Step 3 — BigQuery table/views** — `scripts/03-setup-bigquery.sh`
Ensures dataset/table exist; creates a convenience view normalizing the log export schema into the `LogEntry` shape the app expects.

**Step 4 — Build & deploy to Cloud Run** — `scripts/04-deploy-cloudrun.sh`
Builds the container, creates the least-privilege runtime service account (viewer roles only — see §7.7), deploys the service with env vars from a secrets reference (use Secret Manager for `ANTHROPIC_API_KEY` and the Chat webhook), and prints the service URL.

**Step 5 — Scheduler (the heartbeat)** — `scripts/05-setup-scheduler.sh`
Creates a Cloud Scheduler job hitting `POST /monitor` every `MONITOR_INTERVAL_MINUTES`, authenticated with OIDC against the Cloud Run service.

**Step 6 — Google Chat bot registration (manual, one-time, UI)**
README documents: in Google Cloud Console → Google Chat API → Configuration, set the bot's endpoint to `https://<cloud-run-url>/chat`, set auth audience, add the bot to the support space. The incoming webhook for *alerts* is created in the target Chat space's "Manage webhooks" and pasted into `GOOGLE_CHAT_WEBHOOK_URL`.

**Step 7 — Verify in prod**
- Confirm `/health` is reachable.
- Post a question in the Chat space → bot answers.
- Lower a threshold temporarily in `thresholds.yaml`, redeploy, confirm an alert fires, then restore.

---

## 10. Definition of done (Claude Code: do not stop until all true)

- [ ] `npm run build` clean (strict TS, no `any` leaks in public APIs).
- [ ] `npm run test:cov` green, >85% on `anomaly/`, `mcp/tools/`, `chat/cards.ts`, `config/`.
- [ ] All 5 MCP tools list and respond via MCP Inspector.
- [ ] Chat bot answers a simulated question and rejects unauthenticated calls.
- [ ] Monitor dry-run produces a structured decision and respects cooldown.
- [ ] All 5 deploy scripts pass `bash -n` and support `DRY_RUN=1`.
- [ ] README documents local run, testing, deployment, and the Chat bot registration steps.
- [ ] No mutation paths to production anywhere; runtime SA is viewer-only.

---

## 11. Build order reminder for Claude Code

Implement Phase 0 → 8 strictly in order. After each phase, run the gate. If a gate fails, fix before advancing. Generate the tests in §5 alongside (not after) the code they cover. Keep all I/O behind injectable interfaces so every test runs offline. When unsure about a GCP schema detail, write the code against the `LogEntry`/view contract in §4.2 and leave a `// VERIFY: schema mapping` comment rather than guessing silently.
