#!/bin/bash
# ==============================================================================
# Apigee Emulator - Stop Trace Session & Download Transactions
# Retrieves recorded transactions from the active trace session, saves them to
# a JSON file, and provides visualizer guidance.
#
# HOW TO USE:
#   ./emulator/trace_stop.sh [OUTPUT_FILE]
#
# Examples:
#   ./emulator/trace_stop.sh                    # Saves to emulator/trace.json
#   ./emulator/trace_stop.sh my_custom_trace.json
# ==============================================================================

# Guard against sourcing in an interactive terminal
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  echo -e "\033[1;31mError: trace_stop.sh must be executed directly, not sourced.\033[0m" >&2
  echo -e "Please run:\n  \033[1;32m./emulator/trace_stop.sh\033[0m" >&2
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
OUTPUT_FILE="${1:-$SCRIPT_DIR/trace.json}"

# Show help
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  echo -e "${BOLD}Usage:${NC}"
  echo "  ./emulator/trace_stop.sh [OUTPUT_FILE]"
  echo ""
  echo -e "${BOLD}Description:${NC}"
  echo "  Fetches recorded trace transactions from the active session"
  echo "  and writes them to a JSON file (default: emulator/trace.json)."
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo "  ./emulator/trace_stop.sh"
  echo "  ./emulator/trace_stop.sh my_trace.json"
  exit 0
fi

# 1. Resolve Session ID
SESSION_ID=""
PROXY_NAME=""

if [ -n "$TRACE_SESSION_ID" ]; then
  SESSION_ID="$TRACE_SESSION_ID"
elif [ -n "$SESSION_ID" ]; then
  SESSION_ID="$SESSION_ID"
elif [ -f "$SESSION_FILE" ]; then
  SESSION_ID=$(python3 -c "
import json
try:
    with open('$SESSION_FILE') as f:
        data = json.load(f)
    print(data.get('sessionId', ''))
except:
    pass
")
  PROXY_NAME=$(python3 -c "
import json
try:
    with open('$SESSION_FILE') as f:
        data = json.load(f)
    print(data.get('proxyName', ''))
except:
    pass
")
fi

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}Error: No active trace session found.${NC}" >&2
  echo -e "Start a trace session first with:\n  \033[1;32m./emulator/trace_start.sh\033[0m" >&2
  exit 1
fi

echo -e "${BLUE}Retrieving trace transactions for session ${BOLD}$SESSION_ID${NC}${BLUE}...${NC}"

# 2. Fetch trace transactions directly to output file
curl -s -X GET "$EMULATOR_MGMT_URL/v1/emulator/trace/transactions?sessionid=$SESSION_ID" > "$OUTPUT_FILE"

# 3. Format JSON and count transactions
CAPTURED_COUNT=$(python3 -c "
import json

try:
    with open('$OUTPUT_FILE', 'r') as f:
        data = json.load(f)
    # Re-write formatted JSON
    with open('$OUTPUT_FILE', 'w') as f:
        json.dump(data, f, indent=2)
    messages = data.get('Messages', []) if isinstance(data, dict) else []
    print(len(messages))
except Exception:
    print(0)
")

echo -e "${GREEN}✓ Trace transactions downloaded!${NC}\n"
echo -e "  ${BOLD}Session ID:${NC}   $SESSION_ID"
[ -n "$PROXY_NAME" ] && echo -e "  ${BOLD}Proxy:${NC}        $PROXY_NAME"
echo -e "  ${BOLD}Transactions:${NC} ${CAPTURED_COUNT:-0}"
echo -e "  ${BOLD}Output File:${NC}  \033[4m$OUTPUT_FILE\033[0m (${GREEN}$(wc -c < "$OUTPUT_FILE" 2>/dev/null || echo 0) bytes${NC})\n"

# Clean up session file
rm -f "$SESSION_FILE"

echo -e "${BOLD}Visualizing Trace:${NC}"
echo "  Open 'emulator/trace.html' in your browser and click 'Load File' (or 'Load JSON')"
echo "  or drag & drop the generated trace file: $OUTPUT_FILE"
