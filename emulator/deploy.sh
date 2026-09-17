#!/bin/bash
# ==============================================================================
# Apigee Emulator Deploy Script
# Builds and deploys YAML templates, proxies, or features to a local Apigee Emulator.
#
# HOW TO USE:
#   1. Interactive mode (defaults to proxies/TestProxy.yaml on Enter):
#        ./emulator/deploy.sh
#
#   2. Deploy a specific proxy, template, or feature:
#        ./emulator/deploy.sh proxies/TestProxy.yaml
#        ./emulator/deploy.sh templates/REST-AI-Completions.yaml
#        ./emulator/deploy.sh features/ai-endpoint-completions.yaml
#
#   3. Deploy all templates at once:
#        ./emulator/deploy.sh --all
#
#   4. List available files or view help:
#        ./emulator/deploy.sh --list
#        ./emulator/deploy.sh --help
#
# TRACING:
#   - Start recording trace: ./emulator/trace_start.sh [PROXY_NAME]
#   - Stop & save trace:     ./emulator/trace_stop.sh
#   - Visualize trace:       Open emulator/trace.html in your browser
#
# IMPORTANT:
#   - Execute directly: './emulator/deploy.sh' (do NOT 'source emulator/deploy.sh')
#   - Prerequisites: docker, aft, curl, python3 (with pyyaml), zip, unzip
#   - Management API:  http://localhost:8080 (emulator admin, tree, reset)
#   - Runtime Traffic: http://localhost:8998 (API proxy basepath requests)
#   - Default Test Key: 'x-api-key: test-api-key-12345'
# ==============================================================================

# 1. Guard against sourcing the script in an interactive terminal
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  echo -e "\033[1;31mError: deploy.sh must be executed directly, not sourced.\033[0m" >&2
  echo -e "Please run:\n  \033[1;32m./emulator/deploy.sh\033[0m" >&2
  return 1 2>/dev/null || exit 1
fi

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ANSI Colors
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
BOLD="\033[1m"
NC="\033[0m"

EMULATOR_MGMT_URL="${EMULATOR_MGMT_URL:-http://localhost:8080}"
EMULATOR_ROUTER_PORT="${EMULATOR_ROUTER_PORT:-8998}"
CONTAINER_NAME="${EMULATOR_CONTAINER_NAME:-apigee}"

# ------------------------------------------------------------------------------
# Discovery Functions
# ------------------------------------------------------------------------------
get_available_proxies() {
  find proxies -maxdepth 1 -name "*.yaml" -type f 2>/dev/null | sort
}

get_available_templates() {
  find templates -maxdepth 1 -name "*.yaml" -type f 2>/dev/null | sort
}

get_available_features() {
  find features -maxdepth 1 -name "*.yaml" -type f 2>/dev/null | sort
}

# ------------------------------------------------------------------------------
# Help / Usage Function
# ------------------------------------------------------------------------------
show_help() {
  echo -e "${BOLD}Usage:${NC}
  ./emulator/deploy.sh [OPTIONS] [YAML_FILE...]

${BOLD}Description:${NC}
  Builds Apigee proxy bundles using 'aft' and deploys them to the local
  Apigee Emulator container, along with pre-configured mock test data
  (API products, developer apps, KVMs, and data collectors).
  Supports deploying standalone proxies, complete templates, or individual features.

${BOLD}Options:${NC}
  -h, --help      Show this help message and exit
  -a, --all       Deploy all templates in the 'templates/' directory
  -l, --list      List all available proxies, templates, and features
  -p, --proxies   Choose from proxies in 'proxies/'
  -t, --templates Choose from templates in 'templates/'
  -f, --features  Choose from features in 'features/'

${BOLD}Examples:${NC}
  # Interactive mode (defaults to proxies/TestProxy.yaml on Enter)
  ./emulator/deploy.sh

  # Deploy specific proxy, template, or feature
  ./emulator/deploy.sh proxies/TestProxy.yaml
  ./emulator/deploy.sh templates/REST-AI-Completions.yaml
  ./emulator/deploy.sh features/ai-endpoint-completions.yaml

  # Deploy all available templates
  ./emulator/deploy.sh --all

${BOLD}Environment Variables:${NC}
  EMULATOR_MGMT_URL       Management URL (default: http://localhost:8080)
  EMULATOR_ROUTER_PORT    Runtime router port (default: 8998)
  EMULATOR_CONTAINER_NAME Docker container name (default: apigee)"
}

# ------------------------------------------------------------------------------
# List All Files Function
# ------------------------------------------------------------------------------
list_all() {
  echo -e "${BOLD}Available Proxies in proxies/:${NC}"
  local p_count=0
  while IFS= read -r p; do
    if [ -n "$p" ]; then
      echo "  • $p"
      p_count=$((p_count + 1))
    fi
  done < <(get_available_proxies)
  if [ "$p_count" -eq 0 ]; then
    echo "  (none)"
  fi

  echo -e "\n${BOLD}Available Templates in templates/:${NC}"
  local t_count=0
  while IFS= read -r t; do
    if [ -n "$t" ]; then
      echo "  • $t"
      t_count=$((t_count + 1))
    fi
  done < <(get_available_templates)
  if [ "$t_count" -eq 0 ]; then
    echo "  (none)"
  fi

  echo -e "\n${BOLD}Available Features in features/:${NC}"
  local f_count=0
  while IFS= read -r f; do
    if [ -n "$f" ]; then
      echo "  • $f"
      f_count=$((f_count + 1))
    fi
  done < <(get_available_features)
  if [ "$f_count" -eq 0 ]; then
    echo "  (none)"
  fi
}

# ------------------------------------------------------------------------------
# 2. Check Prerequisites
# ------------------------------------------------------------------------------
check_prerequisites() {
  local missing=()
  for cmd in docker aft curl zip unzip python3; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}Error: Missing required tool(s): ${missing[*]}${NC}" >&2
    echo "Please install the missing tools and re-run this script." >&2
    exit 1
  fi

  # Verify Python has PyYAML
  if ! python3 -c "import yaml" &>/dev/null; then
    echo -e "${RED}Error: Python module 'pyyaml' is required.${NC}" >&2
    echo "Please install it with: pip3 install pyyaml" >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 3. Docker & Emulator Container Health / Startup
# ------------------------------------------------------------------------------
ensure_emulator_running() {
  # Check if Docker daemon is running
  if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon is not running or accessible.${NC}" >&2
    echo "Please start Docker and try again." >&2
    exit 1
  fi

  # Check container status
  local container_status
  container_status=$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)

  if [ -z "$container_status" ]; then
    echo -e "${YELLOW}Warning: Apigee emulator container '$CONTAINER_NAME' does not exist.${NC}"
    if [ -f "$SCRIPT_DIR/create.sh" ]; then
      echo -e "${BLUE}Creating and starting Apigee emulator container...${NC}"
      "$SCRIPT_DIR/create.sh"
    else
      echo -e "${RED}Error: Please create the container first via ./emulator/create.sh${NC}" >&2
      exit 1
    fi
  elif [ "$container_status" != "running" ]; then
    echo -e "${YELLOW}Apigee emulator container '$CONTAINER_NAME' is $container_status. Starting container...${NC}"
    docker start "$CONTAINER_NAME" >/dev/null
  fi

  # Wait for emulator HTTP service to become ready
  echo -ne "${BLUE}Checking Apigee emulator readiness at $EMULATOR_MGMT_URL...${NC}"
  local retries=30
  local ready=0
  for ((i=1; i<=retries; i++)); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EMULATOR_MGMT_URL/v1/emulator/reset" 2>/dev/null || true)
    if [ "$code" = "200" ] || [ "$code" = "201" ]; then
      ready=1
      break
    fi
    echo -ne "."
    sleep 1
  done
  echo ""

  if [ "$ready" -ne 1 ]; then
    echo -e "${RED}Error: Apigee emulator at $EMULATOR_MGMT_URL did not become ready after ${retries}s.${NC}" >&2
    echo -e "You can inspect container logs with:\n  docker logs $CONTAINER_NAME --tail 50" >&2
    exit 1
  fi
  echo -e "${GREEN}✓ Apigee emulator is healthy and ready.${NC}"
}

# ------------------------------------------------------------------------------
# Sub-menu Selector Helper
# ------------------------------------------------------------------------------
browse_and_select() {
  local category_name="$1"
  local getter_fn="$2"
  local default_item="$3"

  local items=()
  while IFS= read -r f; do
    [ -n "$f" ] && items+=("$f")
  done < <($getter_fn)

  if [ ${#items[@]} -eq 0 ]; then
    echo -e "${YELLOW}No YAML files found in $category_name/.${NC}" >&2
    exit 1
  fi

  echo -e "\n${BOLD}Available in $category_name/:${NC}"
  local default_num=1
  for idx in "${!items[@]}"; do
    local num=$((idx + 1))
    local marker=""
    if [ -n "$default_item" ] && [ "${items[$idx]}" = "$default_item" ]; then
      marker=" ${CYAN}(default)${NC}"
      default_num=$num
    fi
    echo -e "  ${BOLD}$num)${NC} ${items[$idx]}$marker"
  done
  echo -e "  ${BOLD}A)${NC} Deploy ALL $category_name"

  echo ""
  read -r -p "Enter selection [1-${#items[@]}, A] (default $default_num): " sub_choice
  sub_choice="${sub_choice:-$default_num}"

  if [[ "$sub_choice" =~ ^[Aa]$ ]]; then
    SELECTED_TEMPLATES=("${items[@]}")
  elif [[ "$sub_choice" =~ ^[0-9]+$ ]] && [ "$sub_choice" -ge 1 ] && [ "$sub_choice" -le "${#items[@]}" ]; then
    SELECTED_TEMPLATES=("${items[$((sub_choice - 1))]}")
  else
    echo -e "${RED}Invalid selection '$sub_choice'. Aborting.${NC}" >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 4. Resolve Templates / Proxies / Features to Deploy
# ------------------------------------------------------------------------------
SELECTED_TEMPLATES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    -l|--list)
      list_all
      exit 0
      ;;
    -a|--all)
      while IFS= read -r file; do
        SELECTED_TEMPLATES+=("$file")
      done < <(get_available_templates)
      shift
      ;;
    -p|--proxies)
      browse_and_select "proxies" get_available_proxies "proxies/TestProxy.yaml"
      shift
      ;;
    -t|--templates)
      browse_and_select "templates" get_available_templates "templates/REST-AI-Completions.yaml"
      shift
      ;;
    -f|--features)
      browse_and_select "features" get_available_features ""
      shift
      ;;
    *)
      if [[ "$1" == -* ]]; then
        echo -e "${RED}Unknown option: $1${NC}" >&2
        show_help
        exit 1
      fi
      SELECTED_TEMPLATES+=("$1")
      shift
      ;;
  esac
done

if [ ${#SELECTED_TEMPLATES[@]} -eq 0 ]; then
  # Interactive mode if a terminal is attached
  if [ -t 0 ]; then
    echo -e "\n${BOLD}Select what you would like to deploy to Apigee Emulator:${NC}"
    echo -e "  ${BOLD}1)${NC} ${CYAN}proxies/TestProxy.yaml${NC} ${GREEN}(default)${NC}"
    echo -e "  ${BOLD}2)${NC} Proxies   (browse proxies/*.yaml)"
    echo -e "  ${BOLD}3)${NC} Templates (browse templates/*.yaml)"
    echo -e "  ${BOLD}4)${NC} Features  (browse features/*.yaml)"
    echo -e "  ${BOLD}A)${NC} Deploy ALL templates"

    echo ""
    read -r -p "Enter selection [1-4, A] (default 1): " choice
    choice="${choice:-1}"

    case "$choice" in
      1)
        SELECTED_TEMPLATES=("proxies/TestProxy.yaml")
        ;;
      2)
        browse_and_select "proxies" get_available_proxies "proxies/TestProxy.yaml"
        ;;
      3)
        browse_and_select "templates" get_available_templates "templates/REST-AI-Completions.yaml"
        ;;
      4)
        browse_and_select "features" get_available_features ""
        ;;
      [Aa])
        while IFS= read -r f; do
          SELECTED_TEMPLATES+=("$f")
        done < <(get_available_templates)
        ;;
      *)
        echo -e "${RED}Invalid selection '$choice'. Aborting.${NC}" >&2
        exit 1
        ;;
    esac
  else
    # Non-interactive fallback default: proxies/TestProxy.yaml
    if [ -f "proxies/TestProxy.yaml" ]; then
      SELECTED_TEMPLATES=("proxies/TestProxy.yaml")
    elif [ -f "templates/REST-AI-Completions.yaml" ]; then
      SELECTED_TEMPLATES=("templates/REST-AI-Completions.yaml")
    else
      read -r first_tpl < <(get_available_templates)
      SELECTED_TEMPLATES=("$first_tpl")
    fi
  fi
fi

# ------------------------------------------------------------------------------
# Main Execution
# ------------------------------------------------------------------------------
check_prerequisites
ensure_emulator_running

DIST_DIR="$ROOT_DIR/emulator/dist"
BUNDLE_DIR="$DIST_DIR/bundle"
ENV_DIR="$BUNDLE_DIR/src/main/apigee/environments/test"
PROXIES_DIR="$BUNDLE_DIR/src/main/apigee/apiproxies"

# Validate test data files exist
TESTDATA_FILES=(
  "datacollectors.json"
  "developerapps.json"
  "developers.json"
  "maps.json"
  "products.json"
)

for td in "${TESTDATA_FILES[@]}"; do
  if [ ! -f "$SCRIPT_DIR/$td" ]; then
    echo -e "${RED}Error: Required test data file missing: emulator/$td${NC}" >&2
    exit 1
  fi
done
echo -e "${GREEN}✓ Test data files verified.${NC}"

# Clean and recreate emulator/dist
rm -rf "$DIST_DIR"
mkdir -p "$PROXIES_DIR"
mkdir -p "$ENV_DIR"

PROXIES=()

for YAML_FILE in "${SELECTED_TEMPLATES[@]}"; do
  if [ ! -f "$YAML_FILE" ]; then
    echo -e "${RED}Error: File not found: $YAML_FILE${NC}" >&2
    exit 1
  fi

  PROXY_NAME=$(python3 -c "
import yaml
with open('$YAML_FILE') as f:
    data = yaml.safe_load(f)
print(data.get('name', '') if isinstance(data, dict) else '')
")

  if [ -z "$PROXY_NAME" ]; then
    PROXY_NAME="$(basename "$YAML_FILE" .yaml)"
  fi

  echo -e "\n${BLUE}Compiling proxy '${BOLD}$PROXY_NAME${NC}${BLUE}' from '$YAML_FILE'...${NC}"
  ZIP_PATH="$DIST_DIR/$PROXY_NAME.zip"
  aft -i "$YAML_FILE" -o "$ZIP_PATH" --no-animation

  TARGET_DIR="$PROXIES_DIR/$PROXY_NAME"
  mkdir -p "$TARGET_DIR"
  unzip -q -o "$ZIP_PATH" -d "$TARGET_DIR"

  # Sanitize any dangling TargetEndpoints in proxy XML (e.g. default route rules)
  python3 -c "
import glob, os, xml.etree.ElementTree as ET

target_dir = '$TARGET_DIR/apiproxy'
target_xmls = glob.glob(f'{target_dir}/targets/*.xml')
targets = [os.path.splitext(os.path.basename(f))[0] for f in target_xmls]

for proxy_file in glob.glob(f'{target_dir}/proxies/*.xml'):
    try:
        tree = ET.parse(proxy_file)
        root = tree.getroot()
        changed = False
        for rr in root.findall('RouteRule'):
            te = rr.find('TargetEndpoint')
            if te is not None and te.text and te.text not in targets:
                if 'googlecloud' in targets:
                    te.text = 'googlecloud'
                    changed = True
                elif len(targets) > 0:
                    te.text = targets[0]
                    changed = True
                else:
                    rr.remove(te)
                    changed = True
        if changed:
            tree.write(proxy_file, encoding='utf-8', xml_declaration=True)
    except Exception as e:
        print(f'Warning during sanitization of {proxy_file}: {e}')
"

  PROXIES+=("$PROXY_NAME")
  echo -e "${GREEN}✓ Successfully compiled $PROXY_NAME${NC}"
done

# Generate test environment configuration
PROXIES_JSON=$(python3 -c "import sys, json; print(json.dumps(sys.argv[1:]))" "${PROXIES[@]}")

cat << EOF > "$ENV_DIR/env.json"
{
  "name": "test"
}
EOF

cat << EOF > "$ENV_DIR/deployments.json"
{
  "proxies": $PROXIES_JSON
}
EOF

# Copy datacollectors.json to environment directory
cp "$SCRIPT_DIR/datacollectors.json" "$ENV_DIR/datacollectors.json"

# Package deployment bundle
DEPLOY_ZIP="$DIST_DIR/bundle.zip"
(cd "$BUNDLE_DIR" && zip -q -r "$DEPLOY_ZIP" src)

# Reset emulator
echo -e "\n${BLUE}Resetting Apigee Emulator state...${NC}"
RESET_CODE=$(curl -s -o /tmp/emulator_reset_resp.txt -w "%{http_code}" -X POST "$EMULATOR_MGMT_URL/v1/emulator/reset")
if [ "$RESET_CODE" != "200" ] && [ "$RESET_CODE" != "201" ]; then
  echo -e "${RED}Error: Failed to reset Apigee Emulator (HTTP $RESET_CODE)${NC}" >&2
  cat /tmp/emulator_reset_resp.txt >&2
  exit 1
fi

# Prepare dynamic products.json ensuring all deployed proxies are authorized
python3 -c "
import json

with open('$SCRIPT_DIR/products.json') as f:
    products = json.load(f)

proxies = json.loads('$PROXIES_JSON')

for prod in products:
    op_group = prod.get('operationGroup', {})
    existing_ops = op_group.get('operationConfigs', [])
    existing_sources = {c.get('apiSource') for c in existing_ops}

    for p in proxies:
        if p not in existing_sources:
            existing_ops.append({
                'apiSource': p,
                'operations': [{'resource': '/'}],
                'quota': {}
            })
            existing_sources.add(p)

    llm_group = prod.get('llmOperationGroup', {})
    existing_llm_ops = llm_group.get('operationConfigs', [])
    existing_llm_sources = {c.get('apiSource') for c in existing_llm_ops}

    for p in proxies:
        if p not in existing_llm_sources:
            for model in ['gemini-3.6-flash', 'claude-sonnet-5', 'gemini-3.6-flash-lite']:
                existing_llm_ops.append({
                    'apiSource': p,
                    'llmOperations': [{'resource': '/', 'model': model}],
                    'llmTokenQuota': {}
                })
            existing_llm_sources.add(p)

with open('$DIST_DIR/products.json', 'w') as f:
    json.dump(products, f, indent=2)
"

# Package test data zip
TESTDATA_ZIP="$DIST_DIR/testdata.zip"
(
  cd "$SCRIPT_DIR"
  zip -q "$TESTDATA_ZIP" datacollectors.json developerapps.json developers.json maps.json
  (cd "$DIST_DIR" && zip -q -u "$TESTDATA_ZIP" products.json)
)

echo -e "${BLUE}Deploying test data (Products, Developer Apps, KVMs)...${NC}"
TEST_STATUS=$(curl -s -o /tmp/emulator_setup_response.txt -w "%{http_code}" -X POST "$EMULATOR_MGMT_URL/v1/emulator/setup/tests" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@$TESTDATA_ZIP")

if [ "$TEST_STATUS" -ne 200 ]; then
  echo -e "${RED}Error: Test data setup failed with HTTP $TEST_STATUS:${NC}" >&2
  cat /tmp/emulator_setup_response.txt >&2
  echo "" >&2
  exit 1
fi
echo -e "${GREEN}✓ Test data deployed successfully.${NC}"

# Deploy proxy bundle
echo -e "${BLUE}Deploying proxy bundle to environment 'test'...${NC}"
DEPLOY_STATUS=$(curl -s -o /tmp/emulator_response.txt -w "%{http_code}" -X POST "$EMULATOR_MGMT_URL/v1/emulator/deploy?environment=test" \
  -H "Content-Type: application/zip" \
  --data-binary "@$DEPLOY_ZIP")

if [ "$DEPLOY_STATUS" -ne 200 ]; then
  echo -e "${RED}Error: Proxy bundle deployment failed with HTTP $DEPLOY_STATUS:${NC}" >&2
  cat /tmp/emulator_response.txt >&2
  echo "" >&2
  exit 1
fi

echo -e "${GREEN}✓ Proxies successfully deployed to Apigee Emulator!${NC}"
cat /tmp/emulator_response.txt
echo ""

# ------------------------------------------------------------------------------
# Display Deployment Tree, Tracing & Test Guidance
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}================================================================${NC}"
echo -e "${BOLD}                     DEPLOYMENT SUMMARY                         ${NC}"
echo -e "${BOLD}================================================================${NC}"

TREE_JSON=$(curl -s "$EMULATOR_MGMT_URL/v1/emulator/tree" 2>/dev/null || echo "[]")
python3 -c "
import json, sys

try:
    tree = json.loads('''$TREE_JSON''')
    if isinstance(tree, list) and tree:
        print('${BOLD}Active Endpoints:${NC}')
        for ep in tree:
            app = ep.get('application', '')
            base = ep.get('basePath', '').lstrip('/')
            print(f'  • {app}: http://localhost:$EMULATOR_ROUTER_PORT/{base}')
    else:
        print('No active endpoints reported.')
except Exception as e:
    print(f'Unable to parse deployment tree: {e}')
"

echo -e "\n${BOLD}Trace Recording:${NC}"
echo -e "  ${CYAN}./emulator/trace_start.sh${NC}      # Starts trace recording session for active proxy"
echo -e "  # Send request(s) to proxy..."
echo -e "  ${CYAN}./emulator/trace_stop.sh${NC}       # Downloads trace to emulator/trace.json & view in trace.html"

echo -e "\n${BOLD}Quick Test Commands:${NC}"
echo -e "  # Test with API Key:"
echo -e "  curl -i \"http://localhost:$EMULATOR_ROUTER_PORT/testproxy\" \\"
echo -e "    -H \"x-api-key: test-api-key-12345\""
echo ""
echo -e "  # View emulator deployment tree:"
echo -e "  curl -s \"$EMULATOR_MGMT_URL/v1/emulator/tree\" | jq ."
echo ""
echo -e "  # View emulator KVM maps:"
echo -e "  curl -s \"$EMULATOR_MGMT_URL/v1/emulator/test/maps\" | jq ."
echo -e "${BOLD}================================================================${NC}\n"
