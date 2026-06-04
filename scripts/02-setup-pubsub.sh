#!/usr/bin/env bash
# Step 2 — Real-time path (optional).
# Creates a Pub/Sub topic and a second log sink exporting WARNING+ to it for
# near-real-time agent triggering. The scheduled poll works without this.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/common.sh"

log "Ensuring Pub/Sub topic ${PUBSUB_TOPIC} exists"
if exists gcloud pubsub topics describe "${PUBSUB_TOPIC}" --project="${GCP_PROJECT_ID}"; then
  log "topic already exists, skipping"
else
  run gcloud pubsub topics create "${PUBSUB_TOPIC}" --project="${GCP_PROJECT_ID}"
fi

SINK_DEST="pubsub.googleapis.com/projects/${GCP_PROJECT_ID}/topics/${PUBSUB_TOPIC}"

log "Creating/updating Pub/Sub log sink ${PUBSUB_SINK_NAME}"
if exists gcloud logging sinks describe "${PUBSUB_SINK_NAME}" --project="${GCP_PROJECT_ID}"; then
  run gcloud logging sinks update "${PUBSUB_SINK_NAME}" "${SINK_DEST}" \
    --project="${GCP_PROJECT_ID}" --log-filter="${SINK_FILTER}"
else
  run gcloud logging sinks create "${PUBSUB_SINK_NAME}" "${SINK_DEST}" \
    --project="${GCP_PROJECT_ID}" --log-filter="${SINK_FILTER}"
fi

log "Granting sink writer identity pubsub.publisher"
WRITER_IDENTITY="$(gcloud logging sinks describe "${PUBSUB_SINK_NAME}" \
  --project="${GCP_PROJECT_ID}" --format='value(writerIdentity)' 2>/dev/null || echo '')"
if [[ -n "${WRITER_IDENTITY}" ]]; then
  run gcloud pubsub topics add-iam-policy-binding "${PUBSUB_TOPIC}" \
    --project="${GCP_PROJECT_ID}" \
    --member="${WRITER_IDENTITY}" --role="roles/pubsub.publisher"
else
  log "writer identity not resolved (dry-run or sink pending); re-run after creation"
fi

log "Done."
