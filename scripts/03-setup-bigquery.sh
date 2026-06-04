#!/usr/bin/env bash
# Step 3 — BigQuery table/views.
# Ensures the dataset exists and creates a convenience view that normalizes the
# log export schema into the LogEntry shape the app expects.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/common.sh"

log "Ensuring BigQuery dataset ${BIGQUERY_DATASET} exists"
if exists bq --project_id="${GCP_PROJECT_ID}" show "${BIGQUERY_DATASET}"; then
  log "dataset already exists, skipping"
else
  run bq --project_id="${GCP_PROJECT_ID}" --location="${GCP_REGION}" mk \
    --dataset "${GCP_PROJECT_ID}:${BIGQUERY_DATASET}"
fi

VIEW_NAME="${BIGQUERY_LOGS_VIEW:-log_entries}"
# VERIFY: schema mapping — column paths depend on the actual log export schema
# produced by the sink. Adjust resource.labels / jsonPayload paths as needed.
VIEW_SQL="$(cat <<SQL
SELECT
  timestamp AS timestamp,
  resource.labels.service_name AS service,
  severity AS severity,
  COALESCE(jsonPayload.message, textPayload) AS message,
  trace AS traceId,
  SAFE_CAST(jsonPayload.latencyMs AS INT64) AS latencyMs
FROM \`${GCP_PROJECT_ID}.${BIGQUERY_DATASET}.${BIGQUERY_LOGS_TABLE}_*\`
SQL
)"

log "Creating/updating view ${VIEW_NAME}"
if exists bq --project_id="${GCP_PROJECT_ID}" show "${BIGQUERY_DATASET}.${VIEW_NAME}"; then
  run bq --project_id="${GCP_PROJECT_ID}" update --use_legacy_sql=false \
    --view "${VIEW_SQL}" \
    "${GCP_PROJECT_ID}:${BIGQUERY_DATASET}.${VIEW_NAME}"
else
  run bq --project_id="${GCP_PROJECT_ID}" mk --use_legacy_sql=false \
    --view "${VIEW_SQL}" \
    "${GCP_PROJECT_ID}:${BIGQUERY_DATASET}.${VIEW_NAME}"
fi

log "Done."
