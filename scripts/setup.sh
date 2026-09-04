#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# ContextForge MCP Gateway — Local Setup Script
# ═══════════════════════════════════════════════════════════════════
#
# Usage: ./scripts/setup.sh
#
# This script:
#   1. Checks prerequisites (docker, python3)
#   2. Generates cryptographic secrets
#   3. Creates .env from .env.example
#   4. Pulls the ContextForge gateway image
#   5. Starts the stack via Docker Compose
#   6. Generates an admin API token
#   7. Runs a smoke test

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Check prerequisites ──────────────────────────────────────────
info "Checking prerequisites..."

command -v docker >/dev/null 2>&1 || error "Docker is required but not installed."
command -v python3 >/dev/null 2>&1 || error "Python 3 is required but not installed."
docker compose version >/dev/null 2>&1 || error "Docker Compose V2 is required."

info "Prerequisites OK"

# ── Navigate to project root ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ── Generate secrets ─────────────────────────────────────────────
info "Generating cryptographic secrets..."

generate_secret() {
    python3 -c "import secrets; print(secrets.token_urlsafe(32))"
}

JWT_SECRET=$(generate_secret)
AUTH_SECRET=$(generate_secret)
ADMIN_PASS=$(generate_secret)
BASIC_PASS=$(generate_secret)
PG_PASS=$(generate_secret)

# ── Create .env ──────────────────────────────────────────────────
if [ -f .env ]; then
    warn ".env already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

info "Creating .env from .env.example..."
cp .env.example .env

# Patch secrets into .env
sed -i.bak "s|JWT_SECRET_KEY=__REPLACE_ME__|JWT_SECRET_KEY=${JWT_SECRET}|" .env
sed -i.bak "s|AUTH_ENCRYPTION_SECRET=__REPLACE_ME__|AUTH_ENCRYPTION_SECRET=${AUTH_SECRET}|" .env
sed -i.bak "s|PLATFORM_ADMIN_PASSWORD=__REPLACE_ME__|PLATFORM_ADMIN_PASSWORD=${ADMIN_PASS}|" .env
sed -i.bak "s|BASIC_AUTH_PASSWORD=__REPLACE_ME__|BASIC_AUTH_PASSWORD=${BASIC_PASS}|" .env
sed -i.bak "s|POSTGRES_PASSWORD=__REPLACE_ME__|POSTGRES_PASSWORD=${PG_PASS}|" .env
rm -f .env.bak

info "Secrets generated and written to .env"
info "  Admin email: admin@yourcompany.com"
info "  Admin password: ${ADMIN_PASS}"
warn "  SAVE THESE CREDENTIALS — they won't be shown again!"

# ── Pull ContextForge image ──────────────────────────────────────
info "Pulling ContextForge gateway image..."
docker pull ghcr.io/ibm/mcp-context-forge:latest

# ── Start the stack ──────────────────────────────────────────────
info "Starting ContextForge stack..."
docker compose up -d

# ── Wait for health ──────────────────────────────────────────────
info "Waiting for gateway to become healthy..."
MAX_WAIT=120
WAITED=0
until curl -sf http://localhost:4444/health >/dev/null 2>&1; do
    if [ $WAITED -ge $MAX_WAIT ]; then
        error "Gateway did not become healthy within ${MAX_WAIT}s"
    fi
    sleep 5
    WAITED=$((WAITED + 5))
    echo -n "."
done
echo ""
info "Gateway is healthy!"

# ── Generate API token ───────────────────────────────────────────
info "Generating admin API token..."
TOKEN=$(docker compose exec -T gateway python3 -m mcpgateway.utils.create_jwt_token \
    --username admin@yourcompany.com \
    --admin \
    --exp 10080 \
    --secret "${JWT_SECRET}" 2>/dev/null | head -1)

echo ""
info "Admin API token (valid for 7 days):"
echo "${TOKEN}"
echo ""

# ── Smoke test ───────────────────────────────────────────────────
info "Running smoke test..."
VERSION=$(curl -s -H "Authorization: Bearer ${TOKEN}" http://localhost:4444/version 2>/dev/null || echo '{"error": "failed"}')
echo "  Version: ${VERSION}"

HEALTH=$(curl -s http://localhost:4444/health 2>/dev/null || echo '{"error": "failed"}')
echo "  Health: ${HEALTH}"

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
info "ContextForge MCP Gateway is running!"
echo ""
echo "  Admin UI:  http://localhost:8080/admin"
echo "  API Docs:  http://localhost:4444/docs"
echo "  Gateway:   http://localhost:4444"
echo "  Nginx:     http://localhost:8080"
echo ""
echo "  Login: admin@yourcompany.com / ${ADMIN_PASS}"
echo ""
echo "  Export the token for API calls:"
echo "    export TOKEN='${TOKEN}'"
echo ""
echo "  Test API:"
echo "    curl -H 'Authorization: Bearer \$TOKEN' http://localhost:4444/tools"
echo ""
echo "  Stop:"
echo "    docker compose down"
echo "═══════════════════════════════════════════════════════════════"
