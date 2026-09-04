# ContextForge × Agent-Server Integration Specification

**Version:** 1.0
**Status:** Draft for review
**Date:** 2026-09-04
**Scope:** Integrating IBM ContextForge MCP Gateway as the centralized tool gateway for the CodeStudio Agent Service

---

## 1. Executive Summary

### 1.1 Current State

The `agent-server` manages MCP servers **per-org** with its own connection validator, OAuth broker, token storage, and tool discovery. Each MCP server is stored in `mcp_servers` with inline `toolsJson`, OAuth tokens in `mcp_oauth_tokens`, and agents link to servers via `mcpServerIds` JSONB array.

### 1.2 Target State

ContextForge becomes the **centralized MCP gateway**, handling:
- Server registration, health monitoring, and circuit breaking
- OAuth negotiation (RFC 7591 DCR, RFC 8414 discovery, PKCE)
- Token storage and refresh (AES-256-GCM encrypted, optional Vault backend)
- Tool discovery and caching
- Virtual server composition
- Multi-tenant isolation via Teams

The agent-server becomes a **bridge client** that:
- Maps `orgId` → ContextForge Team
- Proxies MCP server CRUD through ContextForge APIs
- Resolves tools from ContextForge for agent configuration
- Issues scoped tokens for worker runtime tool invocation
- Retains its existing agent, run, thread, and HITL models unchanged

### 1.3 What Does NOT Change

| Component | Status |
|-----------|--------|
| Agents model (`agents` table, CRUD, scope model) | **Unchanged** |
| Runs / Threads / RunEvents | **Unchanged** |
| BullMQ job queue system | **Unchanged** |
| SSE streaming pipeline | **Unchanged** |
| HITL approval flow | **Unchanged** |
| Git OAuth connections (GitHub/GitLab/Gitea) | **Unchanged** |
| Sandbox templates / E2B | **Unchanged** |
| Gateway auth plugin (identity propagation) | **Unchanged** |
| Built-in tools (ls, read_file, write_file, etc.) | **Unchanged** |
| Scope/visibility model (private/team/org) | **Unchanged** — maps to CF Teams |

---

## 2. Architecture

### 2.1 Current Architecture

```
Client App → Gateway (auth) → Agent-Server → MCP Server (direct connection)
                                    │
                                    ├── mcp_servers table (registration)
                                    ├── mcp_oauth_tokens table (per-user tokens)
                                    ├── McpConnectionValidator (health check)
                                    ├── McpOAuthService (OAuth broker)
                                    └── McpTokenRefreshService (token refresh)
```

### 2.2 Target Architecture

```
Client App → Gateway (auth) → Agent-Server → ContextForge Gateway → MCP Server
                                    │                 │
                                    │                 ├── Gateway registry
                                    │                 ├── OAuth broker + DCR
                                    │                 ├── Token vault
                                    │                 ├── Tool discovery
                                    │                 ├── Virtual servers
                                    │                 └── Teams (multi-tenant)
                                    │
                                    ├── mcp_servers table (mirrors CF gateway_id)
                                    ├── tenant_cf_mapping (orgId → CF Team ID)
                                    └── Agent/Run/Thread models (unchanged)
```

### 2.3 Ownership Boundary

| Responsibility | Current Owner | Target Owner |
|---------------|--------------|-------------|
| MCP server registration | agent-server | **ContextForge** (agent-server proxies) |
| OAuth negotiation + DCR | agent-server (`McpOAuthService`) | **ContextForge** |
| Token storage + refresh | agent-server (`mcp_oauth_tokens`) | **ContextForge** |
| Tool discovery | agent-server (`McpConnectionValidator`) | **ContextForge** |
| Connection health monitoring | agent-server (`McpValidationManager`) | **ContextForge** |
| Circuit breaking / retries | agent-server (basic retry) | **ContextForge** (advanced) |
| Agent ↔ MCP server linking | agent-server (`mcpServerIds`) | **agent-server** (unchanged) |
| Scope/visibility enforcement | agent-server (`McpAccessValidator`) | **agent-server** (unchanged, maps to CF Teams) |
| Tool invocation at runtime | worker (direct MCP connection) | **worker → CF virtual server** |

---

## 3. Data Model Changes

### 3.1 New Table: `tenant_cf_mapping`

Maps the agent-server's `orgId` to a ContextForge Team.

```sql
CREATE TABLE tenant_cf_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL UNIQUE,
  cf_team_id    TEXT NOT NULL,
  cf_team_slug  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_tenant_cf_org ON tenant_cf_mapping(org_id);
```

### 3.2 Modified Table: `mcp_servers`

Add ContextForge reference columns. **Do not remove existing columns** — they become the source-of-truth cache, keeping the agent-server operational even if CF is temporarily unreachable.

```sql
ALTER TABLE mcp_servers ADD COLUMN cf_gateway_id    TEXT;     -- ContextForge gateway UUID
ALTER TABLE mcp_servers ADD COLUMN cf_server_id     TEXT;     -- CF virtual server UUID (if mapped)
ALTER TABLE mcp_servers ADD COLUMN cf_catalog_id    TEXT;     -- CF catalog entry ID (e.g. "stripe")
ALTER TABLE mcp_servers ADD COLUMN cf_synced_at     TIMESTAMPTZ;
ALTER TABLE mcp_servers ADD COLUMN cf_sync_status   TEXT DEFAULT 'pending';
  -- 'pending' | 'synced' | 'error' | 'local_only'

CREATE INDEX idx_mcp_cf_gateway ON mcp_servers(cf_gateway_id) WHERE cf_gateway_id IS NOT NULL;
```

**Migration strategy**: Existing rows get `cf_sync_status = 'local_only'`. A background migration job registers each existing MCP server with ContextForge and populates `cf_gateway_id`.

### 3.3 Table: `mcp_oauth_tokens` — Phase-Out Plan

| Phase | Token Storage | Refresh | Notes |
|-------|--------------|---------|-------|
| Phase 1 | agent-server DB (current) | agent-server | CF not yet handling OAuth |
| Phase 2 | **dual-write**: agent-server + CF | CF preferred | Fallback to local |
| Phase 3 | **CF only** | CF | agent-server table deprecated |

During Phase 2, the `McpOAuthService` writes tokens to both local DB and CF. Token reads prefer CF; fall back to local on CF timeout.

### 3.4 Unchanged Tables

These tables are **not modified**:
- `agents` — still stores `mcpServerIds` as JSONB array of UUIDs
- `runs`, `threads`, `run_events`, `run_interrupts`
- `oauth_connections` (Git providers — separate from MCP OAuth)
- `skills`, `sandbox_templates`, `artifacts`

---

## 4. Service Layer Changes

### 4.1 New Service: `ContextForgeClient`

```typescript
// src/services/contextforge-client.ts

interface ContextForgeClientConfig {
  baseUrl: string;           // CF gateway URL (e.g., http://contextforge:4444)
  adminToken: string;        // Long-lived admin JWT for CF API calls
  timeout: number;           // Request timeout (default: 30s)
}

class ContextForgeClient {
  // ── Team Management ──
  async createTeam(orgId: string, name: string): Promise<CFTeam>;
  async getTeamForOrg(orgId: string): Promise<CFTeam | null>; // looks up tenant_cf_mapping
  async ensureTeam(orgId: string): Promise<CFTeam>;            // create-if-not-exists

  // ── Gateway (MCP Server) Management ──
  async registerGateway(teamId: string, input: RegisterGatewayInput): Promise<CFGateway>;
  async updateGateway(gatewayId: string, input: UpdateGatewayInput): Promise<CFGateway>;
  async deleteGateway(gatewayId: string): Promise<void>;
  async listGateways(teamId: string): Promise<CFGateway[]>;
  async getGateway(gatewayId: string): Promise<CFGateway>;

  // ── Tool Discovery ──
  async listTools(teamId?: string, gatewayId?: string): Promise<CFTool[]>;
  async fetchToolsForGateway(gatewayId: string): Promise<{ success: boolean; tools: CFTool[] }>;

  // ── Virtual Servers ──
  async createVirtualServer(teamId: string, name: string, toolIds: string[]): Promise<CFVirtualServer>;
  async updateVirtualServer(serverId: string, toolIds: string[]): Promise<CFVirtualServer>;

  // ── OAuth ──
  async initiateOAuth(gatewayId: string, userEmail: string): Promise<{ authUrl: string; state: string }>;
  async getOAuthStatus(gatewayId: string, userEmail: string): Promise<{ connected: boolean }>;
  async revokeOAuth(gatewayId: string, userEmail: string): Promise<void>;

  // ── Scoped Token for Worker ──
  async generateScopedToken(teamId: string, userEmail: string, ttlMinutes?: number): Promise<string>;

  // ── Catalog ──
  async getCatalog(): Promise<CFCatalogEntry[]>;
  async connectCatalogServer(serverId: string): Promise<CFGateway>;

  // ── Health ──
  async healthCheck(): Promise<{ status: string }>;
}
```

### 4.2 Modified Service: `McpServerService`

The existing `McpServerService` is modified to **proxy through ContextForge** while maintaining the local DB as a cache.

```typescript
// Modified create flow
async create(orgId, userId, userName, input) {
  // 1. Ensure CF team exists for this org
  const team = await this.cfClient.ensureTeam(orgId);

  // 2. Register gateway in ContextForge (scoped to team)
  const cfGateway = await this.cfClient.registerGateway(team.cf_team_id, {
    name: input.name,
    url: input.url,
    transport: input.transport === 'sse' ? 'SSE' : 'STREAMABLEHTTP',
    authType: this.mapAuthType(input.authType),
    oauthConfig: input.authType.startsWith('oauth') ? {
      clientId: input.oauthClientId,
      clientSecret: input.oauthClientSecret, // CF encrypts at rest
      authorizationUrl: input.oauthAuthorizationUrl,
      tokenUrl: input.oauthTokenUrl,
      scopes: input.oauthScopes,
    } : undefined,
  });

  // 3. Create local row with CF reference
  const server = await this.mcpServerRepo.create({
    ...input,
    orgId,
    createdByUserId: userId,
    createdBy: userName,
    status: 'pending',
    cfGatewayId: cfGateway.id,
    cfSyncStatus: 'synced',
    cfSyncedAt: new Date(),
  });

  // 4. CF handles connection validation async — poll or webhook for status
  return server;
}
```

### 4.3 Modified Service: `McpOAuthService`

Phase 2: OAuth initiation routes through ContextForge.

```typescript
// Modified OAuth initiation
async initiateOAuth(serverId: string, userId: string, orgId: string) {
  const server = await this.mcpServerRepo.findById(serverId);
  if (!server.cfGatewayId) {
    // Fallback to current local OAuth flow for un-migrated servers
    return this.initiateOAuthLocal(serverId, userId, orgId);
  }

  // Route through ContextForge
  const team = await this.cfClient.getTeamForOrg(orgId);
  const userEmail = await this.resolveUserEmail(userId, orgId);

  const result = await this.cfClient.initiateOAuth(server.cfGatewayId, userEmail);
  return { authUrl: result.authUrl, state: result.state };
}
```

### 4.4 Modified: Tool Resolution for Agents

```typescript
// src/routes/tools.route.ts — getMcpToolsForAgent()

async function getMcpToolsForAgent(agentId: string, identity: RequestIdentity) {
  const agent = await agentService.get(agentId, identity);
  const mcpServerIds = agent.mcpServerIds || [];

  // Fetch local MCP server rows (contain cfGatewayId references)
  const servers = await mcpServerRepo.findByIds(mcpServerIds, identity.orgId);

  const allTools: McpHitlToolDefinition[] = [];

  for (const server of servers) {
    if (server.cfGatewayId && server.cfSyncStatus === 'synced') {
      // Fetch tools from ContextForge (fresher than local cache)
      try {
        const cfTools = await cfClient.listTools(null, server.cfGatewayId);
        for (const tool of cfTools) {
          allTools.push({
            name: tool.name,
            description: tool.description || '',
            server_id: server.id,  // Local UUID for HITL
          });
        }
      } catch {
        // Fallback to local cache
        for (const tool of (server.toolsJson || [])) {
          allTools.push(buildMcpHitlTool(server, tool));
        }
      }
    } else {
      // Local-only server — use existing flow
      for (const tool of (server.toolsJson || [])) {
        allTools.push(buildMcpHitlTool(server, tool));
      }
    }
  }

  return groupMcpHitlToolsByServer(allTools);
}
```

### 4.5 Modified: Worker Tool Invocation

The worker currently connects directly to MCP servers. With ContextForge, the worker connects to a **CF virtual server endpoint** instead.

```typescript
// In worker — tool invocation path

async function invokeMcpTool(toolCall: ToolCall, runContext: RunContext) {
  const server = await getServerForTool(toolCall.serverId);

  if (server.cfGatewayId) {
    // Route through ContextForge virtual server
    const team = await cfClient.getTeamForOrg(runContext.orgId);
    const token = await cfClient.generateScopedToken(team.cf_team_id, runContext.userEmail, 60);
    const endpoint = `${CF_BASE_URL}/servers/${server.cfServerId || server.cfGatewayId}/mcp`;

    // Connect via MCP Streamable HTTP with scoped token
    return mcpClient.callTool(endpoint, token, toolCall.name, toolCall.arguments);
  } else {
    // Direct connection (existing flow for un-migrated servers)
    return mcpClient.callToolDirect(server.url, server.headers, toolCall);
  }
}
```

---

## 5. Multi-Tenancy Mapping

### 5.1 Identity Mapping

| Agent-Server | ContextForge | Mapping |
|-------------|-------------|---------|
| `orgId` (from `X-Org-Id`) | **Team** | `tenant_cf_mapping.org_id → cf_team_id` |
| `userId` (from `X-User-Id`) | **User email** | Derived: `{userId}@{orgId}.internal` or actual email |
| `teamId` (from `X-Team-Id`) | N/A (CF uses Team-level isolation) | Agent-server's `teamId` maps to CF Team scope |

### 5.2 Scope Mapping

| Agent-Server Scope | ContextForge Equivalent | How |
|-------------------|------------------------|-----|
| `scope: "private"` | Gateway registered under user's personal CF Team | One CF team per user (optional) or team_id = orgId |
| `scope: "team"` + `sharedWithTeamIds` | Gateway registered under the CF Team(s) | One CF Team per agent-server teamId |
| `scope: "org"` | Gateway registered under the org-level CF Team | CF Team = orgId |

**Recommended approach (simplest):** One CF Team per `orgId`. Scope enforcement stays in agent-server's `McpAccessValidator` — CF provides the gateway/tool registry, agent-server provides the visibility layer.

### 5.3 Tenant Provisioning Flow

```
User's first request to agent-server
  │
  ├─ gateway-auth plugin extracts orgId from X-Org-Id header
  │
  ├─ Any MCP-related route handler calls: cfClient.ensureTeam(orgId)
  │    │
  │    ├─ Check tenant_cf_mapping for orgId
  │    │    ├─ Found → return cached cf_team_id
  │    │    └─ Not found → POST /teams/ to CF → store mapping → return
  │    │
  │    └─ Team created in CF with:
  │         name: "org-{orgId}"
  │         slug: orgId
  │         visibility: "private"
  │
  └─ All subsequent CF API calls include team_id parameter
```

---

## 6. API Changes

### 6.1 Existing Endpoints — Modified Behavior

| Endpoint | Current | After Integration |
|----------|---------|-------------------|
| `POST /mcp-servers` | Creates local row + validates | Creates in CF + local row with `cfGatewayId` |
| `PATCH /mcp-servers/:id` | Updates local row + re-validates | Updates CF gateway + local row |
| `DELETE /mcp-servers/:id` | Soft-deletes local row | Deletes CF gateway + soft-deletes local |
| `POST /mcp-servers/:id/connection/refresh` | Local re-validation | Triggers CF re-validation |
| `GET /mcp-servers` | Queries local DB | Queries local DB (CF status synced periodically) |
| `GET /tools?agentId=` | Reads local `toolsJson` | Reads from CF (fallback to local cache) |
| `POST /mcp-servers/:id/oauth/initiate` | Local OAuth flow | Routes through CF OAuth |
| `GET /mcp-servers/:id/oauth/callback` | Local token exchange | CF handles callback + stores token |
| `GET /mcp-servers/:id/oauth/status` | Checks local `mcp_oauth_tokens` | Checks CF token status |
| `POST /mcp-servers/:id/disconnect` | Resets local status | Revokes CF token + resets local |

### 6.2 New Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /mcp-catalog` | Returns ContextForge's 100+ server catalog |
| `POST /mcp-catalog/:id/connect` | Registers a catalog server as a gateway in CF |
| `GET /mcp-servers/:id/cf-status` | Returns ContextForge sync status for a server |

### 6.3 Unchanged Endpoints

All agent, run, thread, skill, artifact, sandbox, Git OAuth, health, streaming, and internal endpoints remain **completely unchanged**.

---

## 7. Configuration Changes

### 7.1 New Environment Variables

```env
# ContextForge Gateway
CONTEXTFORGE_BASE_URL=http://contextforge:4444   # Internal URL to CF gateway
CONTEXTFORGE_ADMIN_TOKEN=<jwt>                    # Pre-generated admin token for CF API
CONTEXTFORGE_ENABLED=false                        # Feature flag (false = existing behavior)
CONTEXTFORGE_TIMEOUT_MS=30000                     # Request timeout
CONTEXTFORGE_SYNC_INTERVAL_MS=300000              # Background sync interval (5 min)
```

### 7.2 Feature Flag Strategy

`CONTEXTFORGE_ENABLED` controls the integration:

| Value | Behavior |
|-------|----------|
| `false` (default) | Existing behavior — no CF calls, all local |
| `true` | New servers → CF; existing servers → gradual migration |

This allows **zero-risk deployment** — enable per environment.

---

## 8. Migration Plan

### Phase 0: Deploy ContextForge (Week 1)

- [x] ContextForge deployed with PostgreSQL + Redis (done)
- [x] Admin token generated and stored in secrets manager
- [ ] Network connectivity verified: agent-server → CF gateway
- [ ] CF health check integrated into agent-server `/health` endpoint

### Phase 1: Read-Only Integration (Week 2)

- [ ] `ContextForgeClient` service implemented
- [ ] `tenant_cf_mapping` table created
- [ ] `mcp_servers` table columns added (`cf_gateway_id`, etc.)
- [ ] `/mcp-catalog` endpoint exposed (read-only from CF catalog)
- [ ] `CONTEXTFORGE_ENABLED=false` (no behavior change yet)

### Phase 2: Dual-Write for New Servers (Week 3)

- [ ] `McpServerService.create()` writes to CF + local DB
- [ ] `McpServerService.update()` syncs to CF
- [ ] `McpServerService.delete()` deletes from CF
- [ ] OAuth initiation routes through CF for new servers
- [ ] Tool resolution prefers CF (falls back to local cache)
- [ ] **Feature flag**: `CONTEXTFORGE_ENABLED=true` in staging

### Phase 3: Background Migration (Week 4)

- [ ] Migration job: iterates existing `mcp_servers` where `cf_gateway_id IS NULL`
- [ ] Registers each in CF, updates `cf_gateway_id`
- [ ] Verifies tool discovery parity (local `toolsJson` vs CF tools)
- [ ] Handles failures gracefully: `cf_sync_status = 'error'`, retries

### Phase 4: Worker Integration (Week 5)

- [ ] Worker resolves CF virtual server endpoint for tool invocation
- [ ] Worker uses scoped CF tokens instead of direct MCP connections
- [ ] Direct connection fallback for `cf_sync_status != 'synced'` servers
- [ ] Load testing: verify latency is acceptable through CF proxy

### Phase 5: Local OAuth Phase-Out (Week 6+)

- [ ] Stop writing to local `mcp_oauth_tokens` for CF-managed servers
- [ ] Deprecation notice on local OAuth service
- [ ] Remove `McpConnectionValidator` usage for CF-managed servers
- [ ] Clean up dead code behind feature flag

---

## 9. Failure Modes & Resilience

### 9.1 ContextForge Unavailable

| Operation | Behavior |
|-----------|----------|
| List MCP servers | Returns from local DB cache (stale but functional) |
| Create MCP server | Fails with 502; user retries |
| Tool discovery | Falls back to local `toolsJson` cache |
| Tool invocation | Falls back to direct MCP connection (worker) |
| OAuth initiation | Falls back to local OAuth flow |
| Agent CRUD | **Unaffected** — no CF dependency |
| Runs / Threads | **Unaffected** — no CF dependency |

### 9.2 Sync Drift

Local `toolsJson` may drift from CF's tool registry. Mitigation:
- Background sync job every `CONTEXTFORGE_SYNC_INTERVAL_MS`
- Webhook/polling for CF gateway status changes
- `cf_synced_at` column tracks freshness — stale data triggers re-sync

### 9.3 Tenant Mapping Failure

If `ensureTeam()` fails during first request:
- Retry with exponential backoff (3 attempts)
- Log error and return 503 to client
- Agent-server remains functional for non-MCP operations

---

## 10. Security Considerations

### 10.1 Token Security

| Token | Storage | Rotation |
|-------|---------|----------|
| CF Admin Token | Kubernetes secret / env var | 7-day expiry, auto-rotate via cron |
| CF Scoped Tokens (worker) | In-memory only, 60-min TTL | Per-invocation |
| MCP OAuth Tokens | CF vault (AES-256-GCM) | CF auto-refreshes |

### 10.2 Network Security

- agent-server → CF: Internal network only (no public exposure)
- CF Admin API: Restricted to agent-server's IP / service mesh
- CF Admin UI: Disabled in production (`MCPGATEWAY_UI_ENABLED=false`)
- SSRF protection: `SSRF_ALLOW_PRIVATE_NETWORKS=false` in CF

### 10.3 Multi-Tenant Isolation

- Every CF API call includes `team_id` parameter
- agent-server validates `orgId` from gateway auth before mapping to CF team
- CF enforces team-level data isolation at the database level
- No cross-org data leakage possible (agent-server auth + CF auth double-check)

---

## 11. Testing Strategy

### 11.1 Unit Tests

- [ ] `ContextForgeClient` — mock HTTP responses, verify request construction
- [ ] `McpServerService` (modified) — verify dual-write to CF + local
- [ ] `McpAccessValidator` — existing tests remain valid (scope model unchanged)
- [ ] Tenant mapping — verify `ensureTeam()` create-if-not-exists logic

### 11.2 Integration Tests

- [ ] Create MCP server → verify CF gateway created + local row synced
- [ ] Update MCP server → verify CF gateway updated
- [ ] Delete MCP server → verify CF gateway deleted
- [ ] OAuth flow → verify CF OAuth initiation + callback
- [ ] Tool resolution → verify CF tools returned for agent

### 11.3 E2E Tests

- [ ] Full run: create agent with MCP server → create run → tools invoked via CF
- [ ] Tenant isolation: org A cannot see org B's CF gateways
- [ ] Failover: CF down → agent-server serves cached data

### 11.4 Load Tests

- [ ] Tool invocation latency through CF vs direct (target: <100ms overhead)
- [ ] Concurrent MCP server creation across 100 orgs
- [ ] Catalog endpoint under 1000 concurrent users

---

## 12. Rollback Plan

If ContextForge integration causes issues:

1. Set `CONTEXTFORGE_ENABLED=false` — immediate rollback to local-only behavior
2. All local DB data remains intact (dual-write ensures no data loss)
3. Workers fall back to direct MCP connections
4. OAuth tokens in local `mcp_oauth_tokens` remain valid
5. No schema rollback needed — new columns are additive

---

## 13. Open Questions

| # | Question | Impact | Decision Needed By |
|---|----------|--------|--------------------|
| 1 | One CF Team per `orgId` or per `teamId`? | Multi-tenancy granularity | Phase 1 |
| 2 | Should workers connect through CF virtual servers or use CF only for discovery? | Latency vs. centralization | Phase 4 |
| 3 | How to handle existing MCP OAuth tokens during migration? | Token continuity | Phase 3 |
| 4 | Should CF catalog replace or supplement the builtin catalog service? | UX for pre-configured servers | Phase 2 |
| 5 | What is the acceptable latency overhead for routing through CF? | Performance SLA | Phase 4 |
| 6 | Should `cf_gateway_id` be required for new servers or optional? | Migration timeline | Phase 2 |

---

## 14. Appendix: Type Definitions

### A.1 ContextForge API Types

```typescript
interface CFTeam {
  id: string;
  name: string;
  slug: string;
  visibility: 'private' | 'public';
  member_count: number;
  is_personal: boolean;
}

interface CFGateway {
  id: string;
  name: string;
  url: string;
  transport: string;
  enabled: boolean;
  team_id?: string;
  description?: string;
}

interface CFTool {
  id: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  gatewaySlug?: string;
}

interface CFVirtualServer {
  id: string;
  name: string;
  description?: string;
  associatedTools: string[];
}

interface CFCatalogEntry {
  id: string;
  name: string;
  category: string;
  url: string;
  auth_type: string;
  provider: string;
  description: string;
  logo_url: string | null;
  is_registered: boolean;
  gateway_id: string | null;
  tags: string[];
}
```

### A.2 Agent-Server Identity (Unchanged)

```typescript
interface RequestIdentity {
  orgId: string;
  userId: string;
  userName: string;
  role: 'admin' | 'team_lead' | 'member' | 'viewer';
  teamId?: string;
}
```

### A.3 Database Schema Additions

```typescript
// Drizzle ORM additions to mcp_servers
export const mcpServers = pgTable('mcp_servers', {
  // ... existing columns ...
  cfGatewayId:    text('cf_gateway_id'),
  cfServerId:     text('cf_server_id'),
  cfCatalogId:    text('cf_catalog_id'),
  cfSyncedAt:     timestamp('cf_synced_at'),
  cfSyncStatus:   text('cf_sync_status').default('pending'),
});

// New table
export const tenantCfMapping = pgTable('tenant_cf_mapping', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        text('org_id').notNull().unique(),
  cfTeamId:     text('cf_team_id').notNull(),
  cfTeamSlug:   text('cf_team_slug'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at'),
});
```
