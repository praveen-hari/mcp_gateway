# ContextForge Deployment & Client-Server Bridge Specification

**Version:** 1.0
**Status:** Draft for implementation
**Base infrastructure:** IBM/mcp-context-forge (Apache 2.0)
**Owner:** [fill in]
**Last updated:** [fill in]

---

## 1. Purpose & Scope

### 1.1 What this specifies

Two things, deliberately kept separate:

1. **Deployment of ContextForge** as the backend MCP gateway infrastructure — server registry, OAuth broker, tool discovery/routing, multi-tenancy (Teams).
2. **A bridge layer** ("your backend") that connects your own customer-facing client application (agent app with a tools catalog + Connect buttons) to ContextForge, so your users never interact with ContextForge's own Admin UI directly.

### 1.2 What you are NOT building

- An OAuth broker (ContextForge already implements RFC 7591/8414/9728/8707, DCR, and per-user token storage).
- A credential vault (ContextForge's `AUTH_ENCRYPTION_SECRET`-backed encrypted storage, optionally backed by HashiCorp Vault).
- A tool router or circuit breaker (ContextForge's gateway/virtual-server layer).
- A multi-tenancy data model (ContextForge's Teams system).

### 1.3 Success criteria

- A new customer signing up in your product gets an isolated ContextForge Team provisioned automatically, with zero manual admin steps.
- A user in your app can browse a catalog, click "Connect" on a toolkit, complete OAuth in a popup without leaving your app, and see the toolkit's tools become available to their agent — end to end, without ever seeing ContextForge's own domain or branding.
- Your agent runtime can call any connected tool through a single, tenant-scoped MCP endpoint.
- No customer can see or access another customer's registered servers, tokens, or tools.

---

## 2. Architecture Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  Your client app │─────▶│   Your backend    │─────▶│   ContextForge     │─────▶│  Upstream MCP /   │
│ (catalog + UI)   │      │  (bridge/broker)  │      │ (gateway/registry) │      │  REST services    │
└─────────────────┘      └──────────────────┘      └───────────────────┘      └──────────────────┘
                                                              │
                                                              ▼
                                                     ┌───────────────────┐
                                                     │  Virtual server    │
                                                     │  (per-tenant)      │
                                                     └───────────────────┘
                                                              │
                                                              ▼
                                                     ┌───────────────────┐
                                                     │    Your agent      │
                                                     └───────────────────┘
```

**Ownership boundary**: everything left of ContextForge (client app, backend bridge, agent runtime) is yours. ContextForge and everything to its right is infrastructure you deploy and operate, but do not modify.

---

## 3. Part A — ContextForge Deployment Specification

### 3.1 Environment tiers

| Tier | Topology | Command |
|---|---|---|
| Local dev | Single process, SQLite | `mcpgateway --host 0.0.0.0 --port 4444` (via `uvx`/PyPI) |
| Staging | Docker Compose, Postgres + Redis | `docker compose up -d` |
| Production | Kubernetes via Helm, Postgres (managed), Redis, multi-replica | `helm install mcp-gateway .` |

Do not run SQLite in production — it is explicitly a dev/single-node option; Postgres is required for the multi-tenant Teams model and for any multi-replica deployment.

### 3.2 Required secrets (non-negotiable, gateway will not start without these)

| Variable | Purpose | Generation |
|---|---|---|
| `JWT_SECRET_KEY` | HMAC signing key for issued JWTs (32+ chars) | `python3 -m mcpgateway.scripts.init_secrets` |
| `AUTH_ENCRYPTION_SECRET` | AES key deriving passphrase for encrypting stored OAuth credentials, refresh tokens, DCR client secrets | Same script |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | Bootstrap admin account | Set explicitly — no default password, never use `changeme` in production |
| `BASIC_AUTH_PASSWORD` | HTTP Basic auth for the Admin UI/API | Set explicitly |

Store these in your production secrets manager (not `.env` committed to version control), and rotate `JWT_SECRET_KEY` on a defined schedule — note any rotation invalidates outstanding sessions.

### 3.3 Database

```
DATABASE_URL=postgresql+psycopg://user:password@host:5432/contextforge
```

- Use a managed Postgres instance (RDS, Cloud SQL, etc.) in production.
- The schema is 55+ tables covering teams, users, gateways, tools, virtual servers, OAuth tokens, and audit data — do not hand-modify; use ContextForge's own migration tooling.

### 3.4 Multi-tenancy configuration (Teams)

- Teams are the tenant boundary — one Team per customer/organization in your product.
- Configure per-team limits at deployment time (max tools/servers/resources per team) to prevent one noisy tenant from exhausting shared resources.
- Set default resource visibility to **private/team-scoped**, not shared — cross-team sharing must be explicit, never default-on.

### 3.5 SSRF & network security

- `SSRF_ALLOW_PRIVATE_NETWORKS=false` in production (the secure default). Only allowlist specific private ranges (`SSRF_ALLOWED_NETWORKS`) if you genuinely need to register in-cluster/internal MCP servers — never enable broadly.
- Confirm SSRF validation is active for both gateway registration URLs and OAuth configuration URLs (covered in current releases — verify against the changelog for your deployed version).

### 3.6 OAuth / DCR configuration

- Enable Dynamic Client Registration (`MCPGATEWAY_DCR_AUTO_REGISTER_ON_MISSING_CREDENTIALS=true`) so registering a new upstream gateway with just an issuer URL self-configures via RFC 8414/7591 discovery, rather than requiring manual client credential entry per toolkit.
- Set an issuer allowlist for any DCR-capable authorization servers you intend to trust — do not leave this open to arbitrary issuers.
- Confirm `MCPGATEWAY_UI_ENABLED=false` and `MCPGATEWAY_ADMIN_API_ENABLED` restricted (behind your own network boundary/VPN or IP allowlist) in production — your customers should never reach the raw Admin UI; only your backend bridge should have Admin API access.

### 3.7 High availability

- Run 3+ gateway replicas behind a load balancer (Nginx config is provided in the reference Docker Compose stack) once beyond MVP.
- Redis-backed caching and federation required for multi-replica deployments — a single in-memory cache will desync across replicas.
- Configure health checks (`/health` endpoint) at 60s intervals with failure thresholds tuned to your infra's actual restart behavior.

### 3.8 Observability

- Enable OpenTelemetry export to your chosen backend (Phoenix for LLM-specific token/cost metrics, or Jaeger/Zipkin/Datadog/New Relic for general tracing) from day one — do not bolt this on after launch.
- Prometheus metrics endpoint should be scraped continuously; alert on circuit-breaker state changes and OAuth token refresh failure rates.

### 3.9 Deployment checklist

- [ ] Postgres (managed, not SQLite) provisioned
- [ ] Redis provisioned
- [ ] All required secrets generated and stored in a secrets manager, not `.env` in source control
- [ ] `SSRF_ALLOW_PRIVATE_NETWORKS=false` confirmed
- [ ] Admin UI/API access restricted to internal network only
- [ ] Per-team resource limits configured
- [ ] Default resource visibility set to team-private
- [ ] TLS enabled (self-signed for staging, real cert for production)
- [ ] OpenTelemetry export configured and verified
- [ ] Health check + alerting wired to your on-call tooling
- [ ] Backup/restore procedure defined for the Postgres instance

---

## 4. Part B — Client-Server Bridge Specification

### 4.1 Data model (your backend)

```sql
-- Maps your product's own tenants/users to ContextForge's Team/user model
tenant_cf_mapping (
  id uuid pk,
  your_tenant_id text unique,          -- your product's own tenant/org ID
  cf_team_id text,                     -- the provisioned ContextForge Team ID
  created_at timestamptz
);

end_user_cf_mapping (
  id uuid pk,
  your_user_id text,                   -- your product's own user ID
  tenant_cf_mapping_id uuid fk,
  cf_user_email text,                  -- the identity ContextForge tracks per-user OAuth tokens against
  created_at timestamptz
);

-- Cache of connection status per (tenant, toolkit) — avoids polling ContextForge on every page load
toolkit_connections (
  id uuid pk,
  end_user_cf_mapping_id uuid fk,
  toolkit_slug text,                   -- e.g. "notion", "github"
  cf_gateway_id text,                  -- the registered gateway ID in ContextForge
  status text check in ('not_connected','connecting','connected','error','revoked'),
  last_synced_at timestamptz
);
```

### 4.2 Backend API surface (your own endpoints)

| Method | Path | Description |
|---|---|---|
| GET | `/api/catalog` | Returns available toolkits (proxies ContextForge's catalog/search endpoint, cached) |
| GET | `/api/connections` | Returns current user's connection status per toolkit |
| POST | `/api/connections/:toolkit/connect` | Initiates connect flow — returns a popup URL |
| POST | `/api/connections/:toolkit/callback` | Handles post-popup completion, triggers tool fetch + virtual server update |
| DELETE | `/api/connections/:toolkit` | Disconnects (revokes token via ContextForge, updates local status) |
| POST | `/api/agent/tools` | Internal — resolves the tenant's virtual server MCP endpoint + issues a scoped token for your agent runtime |

### 4.3 Tenant provisioning flow (runs once, at customer signup)

1. Your product's signup flow completes → webhook or direct call into your backend.
2. Backend calls ContextForge's Team-management API to create a Team named/keyed to `your_tenant_id`.
3. Backend stores the mapping in `tenant_cf_mapping`.
4. Backend sets per-team resource limits (if your plan tiers require different caps) via ContextForge's admin API.
5. First user in the tenant is provisioned as Team Owner; subsequent users as Members — mirror your own product's role model where reasonable.

### 4.4 Catalog display flow

1. Client app requests `GET /api/catalog`.
2. Your backend calls ContextForge's unified catalog/search endpoint, filtered to what's registered/available for that tenant's Team (plus any globally shared servers, if you choose to offer a shared base catalog alongside tenant-specific ones).
3. Backend merges with `toolkit_connections` status for the requesting user, returns a combined list: `[{ slug, name, icon, connected: bool }]`.
4. Client renders catalog with per-item Connect/Connected state — no ContextForge branding or URLs exposed to the client.

### 4.5 Connect flow (the core interaction)

1. User clicks "Connect" on a toolkit in your client app.
2. Client calls `POST /api/connections/notion/connect`.
3. Backend resolves the user's `cf_team_id` and `cf_user_email`, calls ContextForge's OAuth authorize endpoint for the `notion` gateway scoped to that team/user, requesting **popup-based authorization** (not full-page redirect).
4. Backend returns `{ popupUrl }` to the client.
5. Client opens `popupUrl` in a popup window (`window.open`), and listens for the popup to close (poll `window.closed` or use `postMessage` if ContextForge's popup flow supports it — confirm against the version deployed).
6. User completes consent on the **upstream provider's own screen** (Notion's login/consent UI — this cannot be white-labeled, it belongs to the third party).
7. Popup closes on success.
8. Client calls `POST /api/connections/notion/callback`.
9. Backend calls ContextForge's `/oauth/fetch-tools/{gateway_id}` to trigger discovery.
   - **Known issue to guard against**: a reported bug (version-dependent) where the UI's own "Fetch Tools" button doesn't trigger discovery even though the underlying API call succeeds. Your backend should call the API endpoint directly rather than relying on any UI-driven trigger, and should verify the response (`{"success": true, "message": "..."}`) rather than assuming success.
10. Backend creates or updates the tenant's virtual server, adding the newly discovered tool IDs.
11. Backend updates `toolkit_connections.status = 'connected'`.
12. Client re-fetches `/api/connections`, UI flips to "Connected ✓".

### 4.6 Agent tool invocation flow

1. Your agent runtime needs to call a tool → requests `POST /api/agent/tools` with the tenant/user context.
2. Backend resolves the tenant's virtual server ID, issues a short-lived scoped bearer token (backend's own JWT, or a ContextForge-issued token scoped to that virtual server — confirm which pattern fits your token-issuance model).
3. Backend returns `{ mcpEndpoint, token }`.
4. Agent runtime connects to `mcpEndpoint` (a `/servers/{uuid}/mcp` URL) with the token, and calls tools normally via the MCP protocol.
5. Every call is logged by ContextForge's own audit trail, attributable to the specific team/user — no separate audit logging needed on your side for tool-call-level detail, though you should still log the higher-level "agent session" events in your own system.

### 4.7 Disconnect / revocation flow

1. User clicks "Disconnect" in your app.
2. Backend calls ContextForge's token revocation for that `(gateway, user)` pair.
3. Backend updates `toolkit_connections.status = 'revoked'`.
4. Backend removes the toolkit's tools from the tenant's virtual server (or marks them disabled) so the agent immediately loses access.

### 4.8 Error handling requirements

| Scenario | Required behavior |
|---|---|
| OAuth popup closed without completing consent | Client shows "Connection cancelled," status remains `not_connected` — no partial state |
| `/oauth/fetch-tools` returns `success: false` | Backend retries once after a short delay, then surfaces "Connected but couldn't load tools yet" rather than silently showing zero tools as if nothing happened |
| Upstream token expires and refresh fails | ContextForge marks the token invalid; your backend should poll or subscribe to this status and flip `toolkit_connections.status = 'error'`, prompting the user to reconnect — never let an agent silently fail on a dead connection |
| ContextForge itself is unreachable | Client catalog should degrade gracefully (show cached last-known state with a "connection status may be outdated" notice), not hard-fail the whole page |

---

## 5. Security Requirements

- [ ] Your backend, not the client app, holds ContextForge Admin API credentials — the client app never talks to ContextForge directly.
- [ ] Per-tenant scoping enforced on every backend call to ContextForge (never let one tenant's request resolve against another tenant's Team ID due to a missing check).
- [ ] The popup OAuth URL returned to the client is single-use / short-TTL — do not cache or reuse it across sessions.
- [ ] Agent-facing tokens issued by your backend are scoped and short-lived, not the same long-lived credential used for backend-to-ContextForge admin calls.
- [ ] All tenant-to-Team and user-to-email mappings are stored encrypted at rest if they contain any PII beyond an opaque ID.
- [ ] Rate-limit your own `/api/connections/*/connect` endpoint per user — prevents OAuth-flow abuse/spam.

---

## 6. Milestones

| Phase | Deliverable | Est. duration |
|---|---|---|
| P0 | ContextForge deployed to staging (Docker Compose, Postgres+Redis), secrets configured, one test Team provisioned manually | 3–4 days |
| P1 | Tenant provisioning bridge (`tenant_cf_mapping`, auto-Team-creation on signup) | 3–4 days |
| P2 | Catalog display (`/api/catalog`, client UI) | 3–4 days |
| P3 | Connect flow end-to-end against one real toolkit (popup OAuth, fetch-tools, virtual server update) | 1 week |
| P4 | Agent tool invocation bridge (`/api/agent/tools`, token issuance) | 3–4 days |
| P5 | Disconnect/revocation flow, error-state handling | 3–4 days |
| P6 | Production ContextForge deployment (Helm, HA, observability) | 1 week |
| **Beta** | 3–5 real toolkits connectable, real tenants onboarded | — |

**Total: ~4–5 weeks** — materially faster than the from-scratch build, since the entire OAuth broker, credential vault, and routing layer is already built and proven.

---

## 7. Testing Requirements

- [ ] Tenant isolation: automated test that tenant A's connect flow cannot resolve against tenant B's Team, at every backend endpoint.
- [ ] Popup flow tested against at least one real upstream OAuth provider end-to-end, not mocked, before beta.
- [ ] Simulated ContextForge outage — verify client degrades gracefully per §4.8.
- [ ] Token revocation verified to actually remove agent access immediately, not just update a status flag cosmetically.
- [ ] Load test the catalog endpoint under realistic concurrent tenant traffic.

---

## 8. Open Risks (carried over, still relevant)

- The "Fetch Tools" UI bug pattern (§4.5, step 9) suggests testing your own direct API integration thoroughly rather than assuming parity with whatever the Admin UI does — API and UI paths may not be equally exercised/maintained.
- MCP OAuth ecosystem immaturity generally (per prior research: high rates of DCR implementation flaws across real-world upstream servers) — expect some toolkits in your catalog to have rougher OAuth behavior than others; build your error handling (§4.8) assuming this, not as an edge case.
- ContextForge version currency — pin a specific version for your deployment and track their changelog before upgrading; this project ships frequent releases with real behavioral changes (e.g., popup OAuth was itself a recent addition).
