#!/bin/bash
# ==============================================================================
# Apigee Emulator - Start Trace Session
# Starts a trace recording session for a deployed proxy in the local emulator.
#
# HOW TO USE:
#   ./emulator/trace_start.sh [PROXY_NAME]
#
# Examples:
#   ./emulator/trace_start.sh              # Auto-detects active deployed proxy
#   ./emulator/trace_start.sh TestProxy
#   ./emulator/trace_start.sh REST-AI-Completions
# ==============================================================================

# Guard against sourcing in an interactive terminal
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  echo -e "\033[1;31mError: trace_start.sh must be executed directly, not sourced.\033[0m" >&2
  echo -e "Please run:\n  \033[1;32m./emulator/trace_start.sh\033[0m" >&2
  return 1 2>/dev/null || exit 1
fi

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ANSI Colors
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
BOLD="\033[1m"
NC="\033[0m"

EMULATOR_MGMT_URL="${EMULATOR_MGMT_URL:-http://localhost:8080}"
SESSION_FILE="$SCRIPT_DIR/.trace_session"

# Show help
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  echo -e "${BOLD}Usage:${NC}"
  echo "  ./emulator/trace_start.sh [PROXY_NAME]"
  echo ""
  echo -e "${BOLD}Description:${NC}"
  echo "  Starts a trace recording session in the Apigee Emulator."
  echo "  If PROXY_NAME is not specified, it is automatically detected"
  echo "  from the currently deployed proxies in the emulator."
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo "  ./emulator/trace_start.sh"
  echo "  ./emulator/trace_start.sh TestProxy"
  echo "  ./emulator/trace_start.sh REST-AI-Completions"
  exit 0
fi

# 1. Check if emulator management service is responsive
if ! curl -s -f "$EMULATOR_MGMT_URL/v1/emulator/tree" >/dev/null 2>&1; then
  echo -e "${RED}Error: Apigee emulator is not responding at $EMULATOR_MGMT_URL.${NC}" >&2
  echo -e "Make sure the emulator container is running:\n  ./emulator/deploy.sh" >&2
  exit 1
fi

# 2. Determine target proxy name
PROXY_NAME="$1"

if [ -z "$PROXY_NAME" ]; then
  # Auto-detect from active deployment tree
  TREE_JSON=$(curl -s "$EMULATOR_MGMT_URL/v1/emulator/tree" 2>/dev/null || echo "[]")
  PROXY_NAME=$(python3 -c "
import sys, json
try:
    tree = json.loads('''$TREE_JSON''')
    if isinstance(tree, list) and len(tree) > 0:
        print(tree[0].get('application', ''))
except:
    pass
")
fi

if [ -z "$PROXY_NAME" ]; then
  echo -e "${RED}Error: Could not auto-detect any deployed proxy in the emulator.${NC}" >&2
  echo "Please deploy a proxy first (./emulator/deploy.sh) or specify one explicitly:" >&2
  echo "  ./emulator/trace_start.sh <PROXY_NAME>" >&2
  exit 1
fi

echo -e "${BLUE}Starting trace session for proxy '${BOLD}$PROXY_NAME${NC}${BLUE}'...${NC}"

# 3. Call emulator trace endpoint
RESP=$(curl -s -X POST "$EMULATOR_MGMT_URL/v1/emulator/trace?proxyName=$PROXY_NAME")

SESSION_ID=$(python3 -c "
import sys, json
try:
    data = json.loads('''$RESP''')
    if isinstance(data, dict):
        print(data.get('name', ''))
except Exception as e:
    pass
")

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo -e "${RED}Error: Failed to start trace session.${NC}" >&2
  echo "Response from emulator: $RESP" >&2
  exit 1
fi

# 4. Save session metadata to file
cat << EOF > "$SESSION_FILE"
{
  "sessionId": "$SESSION_ID",
  "proxyName": "$PROXY_NAME",
  "startedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "managementUrl": "$EMULATOR_MGMT_URL"
}
EOF

echo -e "${GREEN}✓ Trace session started successfully!${NC}\n"
echo -e "  ${BOLD}Proxy:${NC}      $PROXY_NAME"
echo -e "  ${BOLD}Session ID:${NC} $SESSION_ID"
echo -e "  ${BOLD}State:${NC}      Saved to \033[4m$SESSION_FILE\033[0m\n"

echo -e "${BOLD}Next Steps:${NC}"
echo "  1. Send your test requests through the proxy (port 8998), e.g.:"
echo -e "     ${CYAN}curl -i http://localhost:8998/testproxy -H \"x-api-key: test-api-key-12345\"${NC}"
echo "  2. Stop tracing and download the recorded trace:"
echo -e "     ${GREEN}./emulator/trace_stop.sh${NC}"
echo "  3. Open 'emulator/trace.html' in your browser to inspect transactions."
