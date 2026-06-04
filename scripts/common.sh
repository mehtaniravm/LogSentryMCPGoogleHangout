#!/usr/bin/env bash
# Shared helpers for LogSentry deploy scripts. Source this at the top of each.
set -euo pipefail

# --- Parameters (override via environment) ---
GCP_PROJECT_ID="${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
GCP_REGION="${GCP_REGION:-us-central1}"
BIGQUERY_DATASET="${BIGQUERY_DATASET:-logsentry}"
BIGQUERY_LOGS_TABLE="${BIGQUERY_LOGS_TABLE:-app_logs}"
SERVICE_NAME="${SERVICE_NAME:-logsentry}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-logsentry-runtime}"
RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
PUBSUB_TOPIC="${PUBSUB_TOPIC:-logsentry-stream}"
LOG_SINK_NAME="${LOG_SINK_NAME:-logsentry-warn-sink}"
PUBSUB_SINK_NAME="${PUBSUB_SINK_NAME:-logsentry-stream-sink}"
SCHEDULER_JOB="${SCHEDULER_JOB:-logsentry-monitor}"
MONITOR_INTERVAL_MINUTES="${MONITOR_INTERVAL_MINUTES:-5}"
# Only export severity >= WARNING to BigQuery (the biggest cost lever).
SINK_FILTER="${SINK_FILTER:-severity>=WARNING}"
DRY_RUN="${DRY_RUN:-0}"

# run CMD...  — execute, or echo when DRY_RUN=1.
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# log MESSAGE — status line to stderr.
log() {
  echo ">> $*" >&2
}

# exists CMD... — true if the probe command succeeds (used for idempotency).
exists() {
  "$@" >/dev/null 2>&1
}
