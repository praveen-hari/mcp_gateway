# ContextForge MCP Gateway — Deployment & Bridge

Centralized MCP gateway infrastructure using [IBM/mcp-context-forge](https://github.com/IBM/mcp-context-forge) (Apache 2.0) with a custom bridge layer for multi-tenant SaaS integration.

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  Your client app │─────▶│  Bridge backend   │─────▶│   ContextForge     │─────▶│  Upstream MCP /   │
│ (catalog + UI)   │      │  (this project)   │      │ (gateway/registry) │      │  REST services    │
└─────────────────┘      └──────────────────┘      └───────────────────┘      └──────────────────┘
```

**What ContextForge provides (you don't build these):**
- OAuth broker (RFC 7591/8414/9728/8707, DCR, per-user token storage)
- Credential vault (AES-encrypted, optional Vault backend)
- Tool router & circuit breaker
- Multi-tenancy via Teams system
- 55+ table schema with migrations
- Admin UI, OpenTelemetry, Prometheus metrics

**What this project adds:**
- Docker Compose stack for staging/production deployment
- Bridge backend mapping your tenants/users → ContextForge Teams/users
- Client-facing API (`/api/catalog`, `/api/connections`, `/api/agent/tools`)
- Setup scripts for secrets, provisioning, and smoke tests

## Quick Start

### Prerequisites

- Docker & Docker Compose V2
- Python 3.11+
- `curl` and `jq` (for smoke tests)

### 1. Setup & Start

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

This will:
1. Generate cryptographic secrets
2. Create `.env` from `.env.example`
3. Pull the ContextForge gateway image
4. Start PostgreSQL, Redis, ContextForge Gateway, and Nginx
5. Generate an admin API token
6. Run smoke tests

### 2. Access

| Service    | URL                           |
|------------|-------------------------------|
| Admin UI   | http://localhost:8080/admin    |
| API Docs   | http://localhost:4444/docs     |
| Gateway    | http://localhost:4444          |
| Nginx      | http://localhost:8080          |

### 3. Register a Toolkit

```bash
export TOKEN='<token-from-setup>'

# Register an MCP server
./scripts/register-toolkit.sh "my-server" "http://localhost:9000/mcp"

# Or via curl directly
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-server","url":"http://localhost:9000/mcp","transport":"STREAMABLEHTTP"}' \
  http://localhost:4444/gateways
```

### 4. Create a Virtual Server

```bash
# List tools
curl -H "Authorization: Bearer $TOKEN" http://localhost:4444/tools | jq '.'

# Create virtual server with discovered tools
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"server":{"name":"my-server","description":"My tools","associated_tools":["<TOOL_ID>"]}}' \
  http://localhost:4444/servers | jq '.'
```

### 5. Connect Agent

```bash
# Get server UUID from step 4, then:
export MCP_SERVER_URL="http://localhost:4444/servers/<SERVER_UUID>/mcp"
export MCP_AUTH="Bearer $TOKEN"

# Use with MCP Inspector
npx -y @modelcontextprotocol/inspector

# Or with Claude Desktop / other MCP clients
```

## Project Structure

```
mcp_gateway/
├── docker-compose.yml          # Full stack: Postgres, Redis, Gateway, Nginx
├── nginx/
│   └── nginx.conf              # Reverse proxy with rate limiting & caching
├── bridge/
│   ├── requirements.txt        # Bridge backend dependencies
│   └── app/
│       ├── main.py             # FastAPI application
│       ├── config.py           # Environment-based configuration
│       ├── models.py           # SQLAlchemy models (tenant/user/connection mappings)
│       ├── routes.py           # API endpoints (catalog, connections, agent tools)
│       └── cf_client.py        # ContextForge API client wrapper
├── scripts/
│   ├── setup.sh                # One-command local setup
│   └── register-toolkit.sh     # Register an upstream MCP server
├── .env.example                # Template with all required variables
├── .gitignore
├── README.md                   # This file
└── contextforge-deployment-and-bridge-spec.md  # Full specification
```

## Bridge Backend API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/catalog` | Available toolkits (proxies CF, cached) |
| `GET`  | `/api/connections` | Current user's connection status per toolkit |
| `POST` | `/api/connections/:toolkit/connect` | Initiate OAuth connect (returns popup URL) |
| `POST` | `/api/connections/:toolkit/callback` | Post-popup completion (triggers tool fetch) |
| `DELETE`| `/api/connections/:toolkit` | Disconnect (revoke token, update status) |
| `POST` | `/api/agent/tools` | Resolve MCP endpoint + scoped token for agent |

## Implementation Phases

| Phase | Deliverable | Status |
|-------|-------------|--------|
| P0 | ContextForge deployed (Docker Compose, Postgres+Redis) | ✅ Ready |
| P1 | Tenant provisioning bridge | 🔲 Scaffold ready |
| P2 | Catalog display (`/api/catalog`) | 🔲 Scaffold ready |
| P3 | Connect flow (OAuth, fetch-tools, virtual server) | 🔲 Scaffold ready |
| P4 | Agent tool invocation (`/api/agent/tools`) | 🔲 Scaffold ready |
| P5 | Disconnect/revocation, error handling | 🔲 Scaffold ready |
| P6 | Production deployment (Helm, HA, observability) | 🔲 Planned |

## Security Checklist

- [ ] Bridge backend holds CF Admin API credentials (client app never has them)
- [ ] Per-tenant scoping enforced on every bridge→CF call
- [ ] OAuth popup URLs are single-use / short-TTL
- [ ] Agent-facing tokens are scoped and short-lived
- [ ] SSRF_ALLOW_PRIVATE_NETWORKS=false in production
- [ ] Admin UI/API restricted to internal network
- [ ] All secrets in a secrets manager, not in `.env` committed to VCS

## Key ContextForge Environment Variables

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET_KEY` | HMAC signing key for JWTs (32+ chars) |
| `AUTH_ENCRYPTION_SECRET` | AES key for encrypting stored OAuth credentials |
| `DATABASE_URL` | PostgreSQL connection (use `postgresql+psycopg://`) |
| `CACHE_TYPE=redis` | Required for multi-replica |
| `SSRF_ALLOW_PRIVATE_NETWORKS` | `false` in production |
| `MCPGATEWAY_UI_ENABLED` | `false` in production (or restrict to VPN) |
| `DCR_AUTO_REGISTER_ON_MISSING_CREDENTIALS` | `true` for auto OAuth config |
| `ALLOW_PUBLIC_VISIBILITY` | `false` for team-private defaults |

## Useful Commands

```bash
# View logs
docker compose logs -f gateway

# Stop stack
docker compose down

# Stop and remove volumes (⚠️ destroys data)
docker compose down -v

# Generate a new API token
export JWT_SECRET_KEY=$(grep '^JWT_SECRET_KEY=' .env | cut -d= -f2)
docker compose exec gateway python3 -m mcpgateway.utils.create_jwt_token \
  --username admin@yourcompany.com --admin --exp 10080 --secret "$JWT_SECRET_KEY"

# Check gateway health
curl http://localhost:4444/health | jq

# List all registered tools
curl -H "Authorization: Bearer $TOKEN" http://localhost:4444/tools | jq
```

## References

- [ContextForge Documentation](https://ibm.github.io/mcp-context-forge/)
- [ContextForge API Guide](https://ibm.github.io/mcp-context-forge/manage/api-usage/)
- [ContextForge GitHub](https://github.com/IBM/mcp-context-forge)
- [MCP Protocol Spec](https://modelcontextprotocol.io)
