#!/usr/bin/env bash
# routing-diagnostic.sh
# ---------------------
# Systematically exercises the Stage 3 routing rules to isolate which
# hypothesis explains the "not routing / not rewriting properly" report.
#
# Sends 5 requests with different `model` values through the Stage 3
# proxy and reports:
#   * HTTP status code
#   * Which upstream provider actually served the response
#     (inferred from response body fingerprints)
#   * Whether the response was cached (X-Cache-Hit header, if surfaced)
#
# Requires:
#   * APIGEE_HOSTNAME  (your Apigee runtime hostname; must be exported)
#   * Stage 3 proxy deployed at /v1/chat/completions-stage3
#
# Usage:
#   ./demo/routing-diagnostic.sh
#   ./demo/routing-diagnostic.sh 2>&1 | tee routing-diagnostic.log

set -uo pipefail

HOST="${APIGEE_HOSTNAME:?export APIGEE_HOSTNAME to your Apigee runtime hostname}"
# STAGE selects which deployed proxy to test. Defaults to stage 3
# (routing + cache, no fallback). Set STAGE=4 to exercise stage 4
# (routing + cache + fallback), which also verifies fallback behavior
# via the x-apigee-fallback response header.
STAGE="${STAGE:-3}"
BASE_PATH="/v1/chat/completions-stage${STAGE}"
# Stage 1 has no -stageN suffix -- handle that explicitly.
[ "$STAGE" = "1" ] && BASE_PATH="/v1/chat/completions"
URL="https://${HOST}${BASE_PATH}"
# Nonce prefix for prompts so each test uses a unique input and defeats
# the semantic cache -- otherwise SCLLookup short-circuits before the
# RouteRule evaluates and we observe cached responses, not routing.
NONCE=$(date +%s%N)

# Test matrix: label | model_id | expected_route | prompt | scenario
# Post-fix routing: google/* -> gemini; everything else -> openai.
# openai-target strips a leading openai/ prefix from $.model before
# forwarding, so both `gpt-4o-mini` and `openai/gpt-4o-mini` succeed.
#
# NOTE: prompts must be SEMANTICALLY DIFFERENT to defeat the 0.9-threshold
# semantic cache. Short label-only differences (Test A/B/C/...) embed to
# vectors close enough that SCLLookup returns a stale cached response
# before the RouteRule evaluates. Use topically distinct prompts.
TESTS=(
  "A|gpt-4o-mini|openai|What is the chemical formula for glucose?|Canonical OpenAI id routes to OpenAI"
  "B|google/gemini-2.5-flash|gemini|Name three moons of Jupiter.|Prefixed Gemini id routes to Gemini"
  "C|gemini-2.5-flash|openai|In what year did the Berlin Wall fall?|Unprefixed 'gemini-2.5-flash' now goes to OpenAI (inverted default) -- OpenAI will 400 with invalid model"
  "D|o1-mini|openai|Who wrote the novel Pride and Prejudice?|OpenAI reasoning model routes to OpenAI (fix for bug 2)"
  "E|openai/gpt-4o-mini|openai|What is the boiling point of nitrogen in kelvin?|openai/ prefix gets stripped before forwarding (fix for bug 1)"
)

hr() { printf '%.0s-' {1..78}; echo; }

echo "Routing diagnostic against ${URL}"
echo "Stage:              ${STAGE}"
echo "Nonce (cache-bust): ${NONCE}"
hr

for row in "${TESTS[@]}"; do
  IFS='|' read -r label model expected prompt scenario <<<"$row"

  echo
  echo "TEST ${label}: model=${model}"
  echo "  expected route:  ${expected}-target"
  echo "  scenario:        ${scenario}"

  # Prepend the nonce so consecutive runs also bypass the cache.
  full_prompt="[${NONCE}] ${prompt}"
  body=$(cat <<JSON
{"model":"${model}","messages":[{"role":"user","content":"${full_prompt}"}]}
JSON
)

  # -s silent, -S show errors, -o body file, -D header file, -w status
  hdr=$(mktemp); resp=$(mktemp)
  status=$(curl -sS -o "$resp" -D "$hdr" -w '%{http_code}' \
    -X POST -H "Content-Type: application/json" \
    -d "$body" "$URL" 2>&1) || status="curl-error"

  # Infer actual upstream from response fingerprint. Order matters --
  # Vertex's OpenAI-compat layer ALSO emits system_fingerprint (as ""),
  # so checking for that field's mere presence is wrong. The reliable
  # signals are:
  #   Vertex/Gemini: usage.extra_properties.google.traffic_type exists
  #                  OR model echoed as "google/..."
  #   OpenAI:        system_fingerprint starts with "fp_" (non-empty)
  echo "  http_status:     ${status}"
  actual=$(python3 - "$resp" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        raw = f.read()
    d = json.loads(raw)
    # Some Vertex errors come back as a single-element array
    if isinstance(d, list) and d:
        d = d[0]
    err = d.get('error', {})
    if err:
        msg = err.get('message', str(err))[:200]
        # Vertex errors have status=INVALID_ARGUMENT etc; OpenAI errors have type=invalid_request_error
        if err.get('status'):
            print(f"VERTEX ERROR (status={err.get('status')}): {msg}")
        elif err.get('type'):
            print(f"OPENAI ERROR (type={err.get('type')}): {msg}")
        else:
            print(f"ERROR: {msg}")
        sys.exit(0)
    extra = d.get('usage', {}).get('extra_properties', {})
    model_echoed = d.get('model', '?')
    fp = d.get('system_fingerprint', None)
    if 'google' in extra:
        print(f"VERTEX/GEMINI (extra_properties.google present, model={model_echoed})")
    elif fp and isinstance(fp, str) and fp.startswith('fp_'):
        print(f"OPENAI (system_fingerprint={fp}, model={model_echoed})")
    elif model_echoed.startswith('google/'):
        print(f"VERTEX/GEMINI (model={model_echoed})")
    elif model_echoed.startswith('gpt-') or model_echoed.startswith('o1-') or model_echoed.startswith('o3-'):
        print(f"OPENAI (model={model_echoed})")
    else:
        snippet = raw[:150].replace('\n',' ')
        print(f"UNKNOWN (model={model_echoed}, fp={fp!r}, first 150: {snippet})")
except Exception as e:
    try:
        snippet = open(sys.argv[1]).read()[:200].replace('\n',' ')
    except Exception:
        snippet = '<no body>'
    print(f"PARSE_ERROR: {e}, raw: {snippet}")
PYEOF
)
  echo "  actual upstream: ${actual}"

  # Correlation ID for Trace correlation
  msgid=$(grep -i 'X-Apigee-Messageid\|X-Apigee-Request-Id' "$hdr" 2>/dev/null | tr -d '\r')
  [ -n "$msgid" ] && echo "  ${msgid}"

  # Fallback detection (stage 4). The AM-CopyVertexFallbackResponse
  # policy is supposed to set x-apigee-fallback but the header is
  # currently dropped (see README §9 Known limitations). Fall back to
  # inferring: if the body came from Vertex but OpenAI transport
  # headers (x-openai-proxy-wasm, cf-ray) are present, the request
  # was routed to OpenAI first and fell back.
  fallback=$(grep -i '^x-apigee-fallback' "$hdr" 2>/dev/null | tr -d '\r')
  if [ -n "$fallback" ]; then
    echo "  ${fallback}"
  elif grep -qi '^x-openai-proxy-wasm' "$hdr" 2>/dev/null; then
    if [[ "$actual" == *"VERTEX/GEMINI"* ]]; then
      echo "  x-apigee-fallback: openai-to-gemini (INFERRED -- OpenAI transport headers present but body is Vertex)"
    else
      echo "  transport: openai (headers include x-openai-proxy-wasm)"
    fi
  fi

  # Cache header
  cached=$(grep -i '^cached-content' "$hdr" 2>/dev/null | tr -d '\r')
  [ -n "$cached" ] && echo "  ${cached}"

  rm -f "$hdr" "$resp"
done

hr
cat <<'EOF'

INTERPRETATION GUIDE (post-fix routing: google/* -> Gemini, else -> OpenAI)

EXPECTED behavior after fixes:
  * TEST A: OPENAI response (200 with completion, or upstream error like
    insufficient_quota / model access). Any OpenAI-shaped response proves
    routing worked.
  * TEST B: VERTEX/GEMINI response (200 with completion, model echoed as
    google/gemini-2.5-flash and extra_properties.google present).
  * TEST C: OPENAI response, likely a `model_not_found` error for
    "gemini-2.5-flash" because OpenAI doesn't know about Gemini models.
    This is CORRECT -- the inverted default sends unprefixed traffic to
    OpenAI which then owns the error semantics.
  * TEST D: OPENAI response, may be a `model_not_found` error if the
    account lacks o1-mini access. That's an OpenAI account issue, not a
    routing bug. Before the fix, this went to Gemini and got a Vertex
    400 "Malformed publisher model".
  * TEST E: OPENAI response, either a completion or an OpenAI upstream
    error -- but NOT "invalid model ID". If you see "invalid model ID",
    the JS-StripOpenAIModelPrefix policy did not run and the openai/
    prefix leaked through to the OpenAI API.

FAILURE MODES:
  If TEST B routes to OpenAI: llm-routing condition regressed.
  If TEST D routes to Gemini: llm-routing condition regressed.
  If TEST E returns OpenAI "invalid model ID": JS strip policy broken.
  If ALL tests return the same upstream despite unique prompts: check
    Trace -- likely the semantic cache is hitting more aggressively than
    expected (lower the threshold from 0.9 or expand test prompts).

If tests still return VERTEX/GEMINI for tests A/C/D/E: the semantic cache
is short-circuiting before routing. This happens when prompts are too
similar (< 0.9 cosine distance). Run the script twice with different
NONCE values, or reduce THRESHOLD in demo/03-add-routing-and-cache.yaml.
EOF
