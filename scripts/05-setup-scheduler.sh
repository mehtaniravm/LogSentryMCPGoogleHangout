#!/usr/bin/env bash
# Step 5 — Scheduler (the heartbeat).
# Creates a Cloud Scheduler job hitting POST /monitor every
# MONITOR_INTERVAL_MINUTES, authenticated with OIDC against the Cloud Run service.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/common.sh"

log "Resolving Cloud Run service URL"
SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" --region="${GCP_REGION}" \
  --format='value(status.url)' 2>/dev/null || echo '')"
if [[ -z "${SERVICE_URL}" ]]; then
  SERVICE_URL="https://${SERVICE_NAME}-PLACEHOLDER.run.app"
  log "service URL not resolved (dry-run or not deployed); using placeholder"
fi
MONITOR_URL="${SERVICE_URL}/monitor"

# Cron schedule: every N minutes.
SCHEDULE="*/${MONITOR_INTERVAL_MINUTES} * * * *"

log "Creating/updating scheduler job ${SCHEDULER_JOB} (${SCHEDULE})"
if exists gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
  --project="${GCP_PROJECT_ID}" --location="${GCP_REGION}"; then
  run gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
    --project="${GCP_PROJECT_ID}" --location="${GCP_REGION}" \
    --schedule="${SCHEDULE}" \
    --uri="${MONITOR_URL}" \
    --http-method=POST \
    --oidc-service-account-email="${RUNTIME_SA_EMAIL}" \
    --oidc-token-audience="${SERVICE_URL}"
else
  run gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
    --project="${GCP_PROJECT_ID}" --location="${GCP_REGION}" \
    --schedule="${SCHEDULE}" \
    --uri="${MONITOR_URL}" \
    --http-method=POST \
    --oidc-service-account-email="${RUNTIME_SA_EMAIL}" \
    --oidc-token-audience="${SERVICE_URL}"
fi

log "Done."
