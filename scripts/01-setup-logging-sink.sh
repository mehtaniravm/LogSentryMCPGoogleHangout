#!/usr/bin/env bash
# Step 1 — Cost-optimized logging sink.
# Creates a BigQuery dataset and a log sink exporting severity>=WARNING to it,
# leaving high-volume INFO/DEBUG in Cloud Logging's cheaper default bucket.
# Grants the sink's writer identity BigQuery dataEditor on the dataset.
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

SINK_DEST="bigquery.googleapis.com/projects/${GCP_PROJECT_ID}/datasets/${BIGQUERY_DATASET}"

log "Creating/updating log sink ${LOG_SINK_NAME} (filter: ${SINK_FILTER})"
if exists gcloud logging sinks describe "${LOG_SINK_NAME}" --project="${GCP_PROJECT_ID}"; then
  run gcloud logging sinks update "${LOG_SINK_NAME}" "${SINK_DEST}" \
    --project="${GCP_PROJECT_ID}" --log-filter="${SINK_FILTER}"
else
  run gcloud logging sinks create "${LOG_SINK_NAME}" "${SINK_DEST}" \
    --project="${GCP_PROJECT_ID}" --log-filter="${SINK_FILTER}"
fi

# Grant the sink's auto-created writer identity permission to write to the dataset.
log "Granting sink writer identity BigQuery dataEditor"
WRITER_IDENTITY="$(gcloud logging sinks describe "${LOG_SINK_NAME}" \
  --project="${GCP_PROJECT_ID}" --format='value(writerIdentity)' 2>/dev/null || echo '')"
if [[ -n "${WRITER_IDENTITY}" ]]; then
  run gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
    --member="${WRITER_IDENTITY}" --role="roles/bigquery.dataEditor"
else
  log "writer identity not resolved (dry-run or sink pending); re-run after creation"
fi

log "Done."
