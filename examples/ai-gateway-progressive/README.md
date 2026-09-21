# llm-routing

Progressive 4-stage AI Gateway example: from a minimal "hello LLM"
proxy to a full multi-provider gateway with routing, semantic cache,
and cross-provider fallback.

## Stages

| Stage | Feature added | Base path |
|:------|:--------------|:----------|
| 1 | Hello LLM (OpenAI-format → Vertex Gemini) | `/v1/chat/completions` |
| 2 | + Model Armor (prompt injection, RAI, SDP filters) | `/v1/chat/completions-stage2` |
| 3 | + Cross-provider routing + Vertex Vector Search semantic cache | `/v1/chat/completions-stage3` |
| 4 | + Cross-provider fallback (the complete AI Gateway) | `/v1/chat/completions-stage4` |

Each stage is a strict superset of the previous — adding one to three
lines in the template's `features:` block.

## Files

**Feature files:**

| File | Purpose |
|:-----|:--------|
| `llm-base.yaml` | Base ProxyEndpoint at `{BASE_PATH}` |
| `llm-openai-format.yaml` | Extracts `$.model` and `$.messages[-1].content` to `llm.model` / `llm.prompt` for downstream policies |
| `llm-model-armor.yaml` | Model Armor sanitization on request (prompt) and response (LLM output) |
| `llm-routing.yaml` | RouteRule that sends `google/*` → Gemini and everything else → OpenAI |
| `llm-semantic-cache.yaml` | SemanticCacheLookup (PreFlow) + SemanticCachePopulate (PostFlow) using Vertex Vector Search |
| `llm-fallback.yaml` | DefaultFaultRule on both targets that ServiceCallouts the other provider on 4xx/5xx |
| `target-vertex-gemini.yaml` | Vertex AI target using OpenAI-compat endpoint (`.../endpoints/openapi/chat/completions`) |
| `target-openai-gpt.yaml` | OpenAI target with KVM lookup for API key + JS policy that strips `openai/` prefix from model IDs |

**Templates:**

| File | Compose |
|:-----|:--------|
| `01-hello-llm.yaml` | base + openai-format + gemini target |
| `02-add-model-armor.yaml` | stage 1 + model-armor |
| `03-add-routing-and-cache.yaml` | stage 2 + openai target + routing + semantic-cache |
| `04-add-fallback.yaml` | stage 3 + fallback |

**Scripts:**

| File | Purpose |
|:-----|:--------|
| `build.sh` | Compile all 4 templates to bundle zips in `/tmp` |
| `deploy-stages-1-3.sh` | Import + deploy stages 1-3 via `--from-template` |
| `routing-diagnostic.sh` | 5-test matrix exercising routing behavior |

## Routing behavior (inverted default)

Requests with `"model": "google/*"` route to Vertex/Gemini. All other
requests (including bare model names like `gpt-4o-mini`, `o1-mini`,
`chatgpt-4o-latest`) route to OpenAI. This inversion protects against
new OpenAI model families that don't match a `gpt-*` prefix.

The `openai-target` runs a JavaScript policy
(`JS-StripOpenAIModelPrefix`) that removes a leading `openai/` from
the outbound `$.model` field so LiteLLM/OpenRouter-style requests
work with the real OpenAI API.

## Deploying

```bash
export APIGEE_ORG=YOUR_ORG
export APIGEE_ENV=YOUR_ENV
export GCP_PROJECT=YOUR_PROJECT
export APIGEE_HOSTNAME=YOUR_HOSTNAME

./build.sh
./deploy-stages-1-3.sh    # stages 1-3 deploy cleanly via --from-template
```

Stage 4 has a known AFT compiler bug (fault-rule XML gets wrapped in
an extra `<Request>` element) that `build.sh` post-processes. For
Stage 4 you must use `--from-bundle=/tmp/stage04-fixed.zip`, not
`--from-template`.

Requires:
- **KVM `openai-credentials/api-key`** for stages 3-4 (OpenAI API key)
- **Model Armor template** at `projects/{org}/locations/us-central1/templates/your-model-armor-template` for stages 2-4
- **Vertex Vector Search** index + endpoint for stages 3-4 (30-60min out-of-band deploy)

## Verifying routing

```bash
./routing-diagnostic.sh              # tests stage 3
STAGE=4 ./routing-diagnostic.sh      # tests stage 4 (also shows fallback)
```

The diagnostic sends 5 requests with different model IDs and reports
which upstream each actually reached. It uses topically-diverse
prompts to defeat the semantic cache.

## Known issues

- **`x-apigee-fallback` header dropped in Stage 4.** The
  `AM-CopyVertexFallbackResponse` policy sets this header but it
  doesn't reach the client. Fallback itself works correctly (verified
  via response body swap OpenAI→Vertex); requires an Apigee Trace
  session to diagnose the header drop.
- **Semantic cache aggressively caches similar prompts.** Use
  topically-different prompts to observe routing behavior cleanly, or
  lower `THRESHOLD` from 0.9 in `03-add-routing-and-cache.yaml`.
