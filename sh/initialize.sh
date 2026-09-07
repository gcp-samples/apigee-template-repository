#!/bin/bash
set -eo pipefail

# Determine Google Cloud Project ID
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [ -z "$PROJECT_ID" ]; then
  echo "Error: GOOGLE_CLOUD_PROJECT is not set." >&2
  exit 1
fi

echo "=== Initializing Apigee Environment for Project: ${PROJECT_ID} ==="

# 1. Enable Required Google Cloud APIs
echo "Enabling Vertex AI API (aiplatform.googleapis.com)..."
gcloud services enable aiplatform.googleapis.com --project="${PROJECT_ID}" >/dev/null 2>&1 || true

# 2. Service Account Setup (Fault-tolerant)
SA_NAME="apigee-service"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Creating service account '${SA_NAME}'..."
  gcloud iam service-accounts create "${SA_NAME}" --project="${PROJECT_ID}" \
      --description="Service account for Apigee access." \
      --display-name="Apigee Service" || true
else
  echo "Service account '${SA_EMAIL}' already exists."
fi

# 3. IAM Role Bindings
echo "Configuring service account IAM permissions..."
for role in roles/run.invoker roles/aiplatform.user roles/modelarmor.user roles/dlp.user; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="${role}" \
      --condition=None >/dev/null 2>&1 || true
done

# Grant Token Creator role to Apigee Service Agent
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)" 2>/dev/null || true)
if [ -n "$PROJECT_NUMBER" ]; then
  APIGEE_SA="service-${PROJECT_NUMBER}@gcp-sa-apigee.iam.gserviceaccount.com"
  gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
      --member="serviceAccount:${APIGEE_SA}" \
      --role="roles/iam.serviceAccountTokenCreator" \
      --project="${PROJECT_ID}" >/dev/null 2>&1 || true
fi

# 4. Access Token for Apigee Management API calls
ACCESS_TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token 2>/dev/null || true)

if [ -n "$ACCESS_TOKEN" ]; then
  # 5. Data Collectors (Fault-tolerant)
  echo "Configuring Apigee Data Collectors..."
  declare -a COLLECTORS=(
    '{"name": "dc_ai_model", "description": "Model name", "type": "STRING"}'
    '{"name": "dc_ai_provider", "description": "Model provider", "type": "STRING"}'
    '{"name": "dc_ai_cost_center", "description": "Cost center", "type": "STRING"}'
    '{"name": "dc_ai_total_token_count", "description": "The total token count", "type": "INTEGER"}'
    '{"name": "dc_ai_prompt_token_count", "description": "The prompt token count", "type": "INTEGER"}'
    '{"name": "dc_ai_response_token_count", "description": "The response token count", "type": "INTEGER"}'
    '{"name": "dc_ai_response_type", "description": "The response type, either streaming or non-streaming", "type": "STRING"}'
    '{"name": "dc_ai_time_first_token", "description": "The time in milliseconds to the first token", "type": "INTEGER"}'
    '{"name": "dc_ai_request_cost", "description": "Request cost", "type": "FLOAT"}'
    '{"name": "dc_ai_response_cost", "description": "Response cost", "type": "FLOAT"}'
    '{"name": "dc_ai_total_cost", "description": "Total cost", "type": "FLOAT"}'
    '{"name": "dc_ai_user", "description": "AI user", "type": "STRING"}'
  )

  for dc in "${COLLECTORS[@]}"; do
    curl -s -X POST "https://apigee.googleapis.com/v1/organizations/${PROJECT_ID}/datacollectors" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H 'Content-Type: application/json; charset=utf-8' \
      -d "${dc}" >/dev/null 2>&1 || true
  done

  # 6. Custom Analytics Reports (Fault-tolerant)
  echo "Configuring Apigee Custom Reports..."
  # Cost Report
  curl -s -X POST "https://apigee.googleapis.com/v1/organizations/${PROJECT_ID}/reports" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{
      "name": "ai_token_cost_by_model_user",
      "displayName": "AI Token Cost by Model and User",
      "chartType": "col",
      "timeUnit": "day",
      "metrics": [
        {"name": "dc_ai_total_cost", "function": "sum"},
        {"name": "dc_ai_request_cost", "function": "sum"},
        {"name": "dc_ai_response_cost", "function": "sum"}
      ],
      "dimensions": ["dc_ai_model", "developer_email"]
    }' >/dev/null 2>&1 || true

  # Model Latency Report
  curl -s -X POST "https://apigee.googleapis.com/v1/organizations/${PROJECT_ID}/reports" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{
      "name": "ai_model_usage_latency",
      "displayName": "AI Model Usage and Latency",
      "chartType": "col",
      "timeUnit": "hour",
      "metrics": [
        {"name": "dc_ai_total_token_count", "function": "sum"},
        {"name": "dc_ai_time_first_token", "function": "avg"},
        {"name": "message_count", "function": "sum"}
      ],
      "dimensions": ["apiproxy", "dc_ai_model", "dc_ai_response_type"]
    }' >/dev/null 2>&1 || true

  # Model Tokens Report
  curl -s -X POST "https://apigee.googleapis.com/v1/organizations/${PROJECT_ID}/reports" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{
      "name": "ai_token_counts_by_model_user",
      "displayName": "AI Token Counts by Model and User",
      "chartType": "col",
      "timeUnit": "day",
      "metrics": [
        {"name": "dc_ai_total_token_count", "function": "sum"},
        {"name": "dc_ai_prompt_token_count", "function": "sum"},
        {"name": "dc_ai_response_token_count", "function": "sum"}
      ],
      "dimensions": ["dc_ai_model", "developer_email"]
    }' >/dev/null 2>&1 || true
fi

echo "=== Initialization Complete ==="
