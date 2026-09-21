#!/usr/bin/env bash
# deploy.sh
# ---------
# Imports and deploys all four stages of the AFT demo. Idempotent
# (uses override=true on deployment). Every stage deploys with
# `gcloud beta apigee apis import --from-template`.
#
# Prerequisites (see README):
#   * gcloud logged in with an account that can create Apigee proxies
#   * Runtime SA created and IAM configured
#   * Apigee KVM `openai-credentials` exists (for stages 3-4)
#   * Model Armor template `your-model-armor-template` exists (for stages 2-4)
#   * Vector Search index endpoint deployed (for stages 3-4)
#
# Usage:
#   export APIGEE_ORG=YOUR_ORG
#   export APIGEE_ENV=YOUR_ENV
#   export GCP_PROJECT=YOUR_PROJECT
#   ./deploy.sh                # deploys all four stages
#   ./deploy.sh 1              # deploys only stage 1
#   ./deploy.sh 1 3 4          # deploys stages 1, 3, and 4

set -uo pipefail

# --- 1. Env-var pre-flight ---------------------------------------------------
missing=()
for var in APIGEE_ORG APIGEE_ENV GCP_PROJECT; do
  if [ -z "${!var:-}" ]; then missing+=("$var"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: required environment variables not set: ${missing[*]}" >&2
  echo >&2
  echo "  export APIGEE_ORG=YOUR_ORG" >&2
  echo "  export APIGEE_ENV=YOUR_ENV" >&2
  echo "  export GCP_PROJECT=YOUR_PROJECT" >&2
  exit 1
fi

RUNTIME_SA="${RUNTIME_SA:-apigee-aft-runtime@${GCP_PROJECT}.iam.gserviceaccount.com}"
DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- 2. Auth pre-flight ------------------------------------------------------
TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  echo "ERROR: could not obtain access token." >&2
  echo "       Run: gcloud auth application-default login" >&2
  exit 1
fi

# Verify token works against the control plane before doing any imports.
probe_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "https://apigee.googleapis.com/v1/organizations/${APIGEE_ORG}")
if [ "$probe_status" != "200" ]; then
  echo "ERROR: cannot reach Apigee control plane (HTTP ${probe_status})." >&2
  echo "       Check that your account can read organizations/${APIGEE_ORG}." >&2
  exit 1
fi

# --- 3. Stage table ----------------------------------------------------------
# stage_num | api_name                          | template_file
STAGES=(
  "1|aft-demo-01-hello-llm|01-hello-llm.yaml"
  "2|aft-demo-02-add-model-armor|02-add-model-armor.yaml"
  "3|aft-demo-03-add-routing-and-cache|03-add-routing-and-cache.yaml"
  "4|aft-demo-04-add-fallback|04-add-fallback.yaml"
)

# Parse args -- default to all four stages.
if [ $# -eq 0 ]; then
  requested="1 2 3 4"
else
  requested="$*"
fi

# --- 4. Deploy loop ----------------------------------------------------------
hr() { printf '%.0s=' {1..70}; echo; }

overall_rc=0
for row in "${STAGES[@]}"; do
  IFS='|' read -r num name tmpl <<<"$row"

  # Skip if not requested
  if ! grep -qw "$num" <<<"$requested"; then continue; fi

  hr
  echo "STAGE ${num}: ${name}"
  echo "  template: ${tmpl}"
  hr

  # --- Import ---
  echo "[stage ${num}] importing template..."
  import_out=$(gcloud beta apigee apis import "${name}" \
    --from-template="${DEMO_DIR}/${tmpl}" \
    --organization="${APIGEE_ORG}" \
    --format='value(revision)' 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  IMPORT FAILED (rc=$rc):"
    echo "$import_out" | sed 's/^/    /'
    overall_rc=1
    continue
  fi
  # gcloud may print the revision on its own line; grab the last numeric field.
  revision=$(echo "$import_out" | grep -oE '[0-9]+' | tail -n1)
  revision="${revision:-1}"
  echo "  imported revision: ${revision}"

  # --- Deploy ---
  echo "[stage ${num}] deploying revision ${revision} to env ${APIGEE_ENV}..."
  deploy_url="https://apigee.googleapis.com/v1/organizations/${APIGEE_ORG}/environments/${APIGEE_ENV}/apis/${name}/revisions/${revision}/deployments?serviceAccount=${RUNTIME_SA}&override=true"
  deploy_resp=$(mktemp)
  deploy_code=$(curl -sS -o "$deploy_resp" -w '%{http_code}' \
    -X POST -H "Authorization: Bearer $TOKEN" \
    "$deploy_url")

  if [ "$deploy_code" != "200" ]; then
    echo "  DEPLOY FAILED (HTTP ${deploy_code}):"
    head -c 500 "$deploy_resp" | sed 's/^/    /'; echo
    rm -f "$deploy_resp"
    overall_rc=1
    continue
  fi
  rm -f "$deploy_resp"
  echo "  deploy accepted (HTTP 200 -- deployment is now PROGRESSING)"

  # --- Poll for READY ---
  echo "[stage ${num}] polling for READY state (max 60s)..."
  status_url="https://apigee.googleapis.com/v1/organizations/${APIGEE_ORG}/environments/${APIGEE_ENV}/apis/${name}/revisions/${revision}/deployments"
  for i in $(seq 1 12); do
    sleep 5
    state=$(curl -sS -H "Authorization: Bearer $TOKEN" "$status_url" \
      | python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  # Response is a Deployment object, not a list, when queried this way
  print(d.get('state', 'UNKNOWN'))
except Exception as e:
  print(f'PARSE_ERROR:{e}')" 2>/dev/null)
    echo "    poll ${i}/12: state=${state}"
    if [ "$state" = "READY" ]; then break; fi
    if [ "$state" = "ERROR" ]; then
      echo "  DEPLOYMENT ENTERED ERROR STATE"
      overall_rc=1
      break
    fi
  done

  if [ "$state" != "READY" ]; then
    echo "  WARNING: deployment did not reach READY within 60s (last state: ${state})"
    echo "  This may still succeed -- Apigee deployments can take up to a few minutes."
    echo "  Check status: curl -H \"Authorization: Bearer \$TOKEN\" '${status_url}'"
    overall_rc=1
  else
    echo "  READY"
  fi

  # --- Smoke test ---
  if [ -n "${APIGEE_HOSTNAME:-}" ]; then
    case "$num" in
      1) path="/v1/chat/completions" ;;
      2) path="/v1/chat/completions-stage2" ;;
      3) path="/v1/chat/completions-stage3" ;;
      4) path="/v1/chat/completions-stage4" ;;
    esac
    echo "[stage ${num}] smoke test: POST https://${APIGEE_HOSTNAME}${path}"
    smoke_code=$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST -H "Content-Type: application/json" \
      -d '{"model":"google/gemini-2.5-flash","messages":[{"role":"user","content":"ping"}]}' \
      "https://${APIGEE_HOSTNAME}${path}")
    echo "    HTTP ${smoke_code}"
    if [ "$smoke_code" = "404" ]; then
      echo "    (404 shortly after deploy is normal -- gateway may take ~30s to pick up the new deployment)"
    fi
  else
    echo "[stage ${num}] APIGEE_HOSTNAME not set -- skipping smoke test"
  fi
done

hr
if [ $overall_rc -eq 0 ]; then
  echo "All requested stages deployed successfully."
  echo
  echo "Next step: run ./routing-diagnostic.sh to exercise routing."
else
  echo "One or more stages had issues -- see output above."
  echo "Common causes:"
  echo "  * KVM openai-credentials missing"
  echo "  * Model Armor template missing"
  echo "  * Runtime SA lacks aiplatform.user / modelarmor.user roles"
  echo "  * Vector Search index endpoint not deployed (stages 3-4 only)"
fi
exit $overall_rc
