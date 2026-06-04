#!/usr/bin/env bash
# Step 4 — Build & deploy to Cloud Run.
# Creates a least-privilege runtime service account (viewer roles only), builds
# the container, and deploys the service. Secrets come from Secret Manager.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/common.sh"

# --- Least-privilege runtime service account (see §7.7: viewer roles only) ---
log "Ensuring runtime service account ${RUNTIME_SA_EMAIL} exists"
if exists gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" --project="${GCP_PROJECT_ID}"; then
  log "service account already exists, skipping"
else
  run gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
    --project="${GCP_PROJECT_ID}" \
    --display-name="LogSentry runtime (read-only)"
fi

for ROLE in roles/logging.viewer roles/bigquery.dataViewer roles/bigquery.jobUser; do
  log "Binding ${ROLE} to runtime SA"
  run gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="${ROLE}"
done

# --- Secrets (referenced, not inlined) ---
# Expects secrets ANTHROPIC_API_KEY and GOOGLE_CHAT_WEBHOOK_URL in Secret Manager.
SECRET_ARGS="ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GOOGLE_CHAT_WEBHOOK_URL=GOOGLE_CHAT_WEBHOOK_URL:latest"

ENV_VARS="GCP_PROJECT_ID=${GCP_PROJECT_ID}"
ENV_VARS="${ENV_VARS},BIGQUERY_DATASET=${BIGQUERY_DATASET}"
ENV_VARS="${ENV_VARS},BIGQUERY_LOGS_TABLE=${BIGQUERY_LOGS_TABLE}"
ENV_VARS="${ENV_VARS},MCP_TRANSPORT=http"
ENV_VARS="${ENV_VARS},MONITOR_INTERVAL_MINUTES=${MONITOR_INTERVAL_MINUTES}"
ENV_VARS="${ENV_VARS},ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-claude-sonnet-4-6}"
ENV_VARS="${ENV_VARS},GOOGLE_CHAT_AUDIENCE=${GOOGLE_CHAT_AUDIENCE:-}"

log "Building and deploying Cloud Run service ${SERVICE_NAME}"
run gcloud run deploy "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --source="${SCRIPT_DIR}/.." \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --set-env-vars="${ENV_VARS}" \
  --set-secrets="${SECRET_ARGS}" \
  --no-allow-unauthenticated \
  --port=8080

log "Service URL:"
run gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" --region="${GCP_REGION}" \
  --format='value(status.url)'

log "Done."
