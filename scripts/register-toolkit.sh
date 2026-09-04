#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Register an upstream MCP server as a toolkit in ContextForge
# ═══════════════════════════════════════════════════════════════════
#
# Usage:
#   ./scripts/register-toolkit.sh <name> <url> [transport] [description]
#
# Examples:
#   ./scripts/register-toolkit.sh "github" "http://localhost:9000/mcp"
#   ./scripts/register-toolkit.sh "notion" "http://notion-mcp:8003/sse" "SSE" "Notion integration"

set -euo pipefail

NAME="${1:?Usage: $0 <name> <url> [transport] [description]}"
URL="${2:?Usage: $0 <name> <url> [transport] [description]}"
TRANSPORT="${3:-STREAMABLEHTTP}"
DESCRIPTION="${4:-MCP toolkit: ${NAME}}"

BASE_URL="${CF_BASE_URL:-http://localhost:4444}"

if [ -z "${TOKEN:-}" ]; then
    echo "Error: TOKEN environment variable is not set."
    echo "Run: export TOKEN=\$(docker compose exec -T gateway python3 -m mcpgateway.utils.create_jwt_token --username admin@yourcompany.com --admin --exp 10080 --secret \"\$JWT_SECRET_KEY\" 2>/dev/null | head -1)"
    exit 1
fi

echo "Registering gateway: ${NAME}"
echo "  URL: ${URL}"
echo "  Transport: ${TRANSPORT}"

RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"${NAME}\",
        \"url\": \"${URL}\",
        \"transport\": \"${TRANSPORT}\",
        \"description\": \"${DESCRIPTION}\"
    }" \
    "${BASE_URL}/gateways")

echo ""
echo "Response:"
echo "${RESPONSE}" | python3 -m json.tool 2>/dev/null || echo "${RESPONSE}"

GATEWAY_ID=$(echo "${RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "${GATEWAY_ID}" ]; then
    echo ""
    echo "Gateway ID: ${GATEWAY_ID}"
    echo ""
    echo "Next steps:"
    echo "  1. Fetch tools: curl -X POST -H 'Authorization: Bearer \$TOKEN' ${BASE_URL}/oauth/fetch-tools/${GATEWAY_ID}"
    echo "  2. List tools:  curl -H 'Authorization: Bearer \$TOKEN' ${BASE_URL}/tools?gateway_id=${GATEWAY_ID}"
fi
