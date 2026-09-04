"""ContextForge API client — wraps calls to the ContextForge gateway."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger(__name__)


class ContextForgeClient:
    """HTTP client for ContextForge Admin API.

    Your backend (bridge) holds the admin credentials — the client app never
    talks to ContextForge directly.
    """

    def __init__(self, base_url: str | None = None, token: str | None = None):
        self.base_url = (base_url or settings.cf_base_url).rstrip("/")
        self._token = token or settings.cf_admin_token
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    # ── Auth ──────────────────────────────────────────────────────

    def _get_headers(self) -> dict[str, str]:
        """Return Authorization header with a valid admin JWT."""
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    # ── Health ────────────────────────────────────────────────────

    async def health_check(self) -> dict:
        """Check ContextForge gateway health."""
        resp = await self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    # ── Teams (Tenant Provisioning) ──────────────────────────────

    async def list_teams(self) -> list[dict]:
        """List all teams."""
        headers = self._get_headers()
        resp = await self._client.get("/teams/", headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data.get("teams", data if isinstance(data, list) else [])

    async def create_team(self, name: str, slug: str | None = None) -> dict:
        """Create a new ContextForge Team for a tenant.

        Maps to: POST /teams
        """
        headers = self._get_headers()
        payload = {
            "name": name,
            "slug": slug or name.lower().replace(" ", "-"),
        }
        resp = await self._client.post("/teams", json=payload, headers=headers)
        resp.raise_for_status()
        team = resp.json()
        logger.info("cf_team_created: team_id=%s name=%s", team.get("id"), name)
        return team

    async def get_team(self, team_id: str) -> dict:
        """Get team details."""
        headers = self._get_headers()
        resp = await self._client.get(f"/teams/{team_id}", headers=headers)
        resp.raise_for_status()
        return resp.json()

    async def add_team_member(self, team_id: str, email: str, role: str = "member") -> dict:
        """Add a user to a team.

        Maps to: POST /teams/{team_id}/members
        """
        headers = self._get_headers()
        payload = {"email": email, "role": role}
        resp = await self._client.post(
            f"/teams/{team_id}/members", json=payload, headers=headers
        )
        resp.raise_for_status()
        return resp.json()

    # ── Gateways (Upstream MCP Servers / Toolkits) ───────────────

    async def list_gateways(self, team_id: str | None = None) -> list[dict]:
        """List registered gateways (upstream MCP servers).

        Maps to: GET /gateways
        """
        headers = self._get_headers()
        params = {}
        if team_id:
            params["team_id"] = team_id
        resp = await self._client.get("/gateways", headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()
        # Handle both paginated and array responses
        if isinstance(data, list):
            return data
        return data.get("gateways", [])

    async def register_gateway(
        self,
        name: str,
        url: str,
        transport: str = "STREAMABLEHTTP",
        description: str = "",
        team_id: str | None = None,
    ) -> dict:
        """Register an upstream MCP server as a gateway.

        Maps to: POST /gateways
        """
        headers = self._get_headers()
        payload = {
            "name": name,
            "url": url,
            "transport": transport,
            "description": description,
        }
        if team_id:
            payload["team_id"] = team_id
        resp = await self._client.post("/gateways", json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()

    # ── Tools ────────────────────────────────────────────────────

    async def list_tools(self, gateway_id: str | None = None, team_id: str | None = None) -> list[dict]:
        """List available tools.

        Maps to: GET /tools
        """
        headers = self._get_headers()
        params: dict = {"include_pagination": "false", "limit": "0"}
        if gateway_id:
            params["gateway_id"] = gateway_id
        if team_id:
            params["team_id"] = team_id
        resp = await self._client.get("/tools", headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("tools", [])

    async def fetch_tools_for_gateway(self, gateway_id: str) -> dict:
        """Trigger tool discovery for a gateway after OAuth connection.

        Maps to: POST /oauth/fetch-tools/{gateway_id}

        NOTE: Known issue — the Admin UI's "Fetch Tools" button may not
        trigger discovery even though this API call succeeds. Always call
        this endpoint directly and verify the response.
        """
        headers = self._get_headers()
        resp = await self._client.post(
            f"/oauth/fetch-tools/{gateway_id}", headers=headers
        )
        resp.raise_for_status()
        result = resp.json()
        if not result.get("success"):
            logger.warning(
                "cf_fetch_tools_failed: gateway_id=%s message=%s",
                gateway_id,
                result.get("message"),
            )
        return result

    # ── Virtual Servers ──────────────────────────────────────────

    async def create_virtual_server(
        self,
        name: str,
        description: str,
        tool_ids: list[str],
        team_id: str | None = None,
    ) -> dict:
        """Create a virtual server bundling tools for a tenant.

        Maps to: POST /servers
        """
        headers = self._get_headers()
        payload = {
            "server": {
                "name": name,
                "description": description,
                "associated_tools": tool_ids,
            }
        }
        if team_id:
            payload["server"]["team_id"] = team_id
        resp = await self._client.post("/servers", json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()

    async def update_virtual_server(self, server_id: str, tool_ids: list[str]) -> dict:
        """Update a virtual server's associated tools.

        Maps to: PUT /servers/{server_id}
        """
        headers = self._get_headers()
        payload = {"associated_tools": tool_ids}
        resp = await self._client.put(
            f"/servers/{server_id}", json=payload, headers=headers
        )
        resp.raise_for_status()
        return resp.json()

    async def list_servers(self) -> list[dict]:
        """List all virtual servers."""
        headers = self._get_headers()
        resp = await self._client.get("/servers", headers=headers, params={"include_pagination": "false", "limit": "0"})
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("servers", [])

    async def get_virtual_server(self, server_id: str) -> dict:
        """Get virtual server details."""
        headers = self._get_headers()
        resp = await self._client.get(f"/servers/{server_id}", headers=headers)
        resp.raise_for_status()
        return resp.json()

    # ── OAuth ────────────────────────────────────────────────────

    async def initiate_oauth(self, gateway_id: str, user_email: str) -> dict:
        """Initiate OAuth authorization for a user on a specific gateway.

        Returns a popup URL the client opens for the user to complete consent.
        """
        headers = self._get_headers()
        # The exact endpoint depends on your ContextForge version;
        # check /docs (Swagger) for the current OAuth flow endpoints
        resp = await self._client.post(
            f"/oauth/authorize/{gateway_id}",
            json={"user_email": user_email},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()

    async def revoke_oauth_token(self, gateway_id: str, user_email: str) -> dict:
        """Revoke OAuth token for a user on a specific gateway."""
        headers = self._get_headers()
        resp = await self._client.post(
            f"/oauth/revoke/{gateway_id}",
            json={"user_email": user_email},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Token Generation ─────────────────────────────────────────

    async def generate_scoped_token(
        self, user_email: str, team_id: str, server_id: str
    ) -> dict:
        """Generate a short-lived scoped token for agent tool invocation.

        This token is scoped to a specific virtual server and user context.
        Maps to: POST /tokens (or use JWT generation utility)
        """
        headers = self._get_headers()
        payload = {
            "username": user_email,
            "teams": [team_id],
            "exp_minutes": 60,  # Short-lived
        }
        resp = await self._client.post("/tokens", json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()

    # ── Catalog ──────────────────────────────────────────────────

    async def get_catalog(self) -> list[dict]:
        """Get the MCP server catalog (100+ pre-configured servers).

        Maps to: GET /v1/catalog
        """
        headers = self._get_headers()
        resp = await self._client.get("/v1/catalog", headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data.get("servers", data if isinstance(data, list) else [])

    async def connect_catalog_server(self, server_id: str) -> dict:
        """Register a catalog server as a gateway (connect it).

        Maps to: POST /v1/catalog/{server_id}/register
        """
        headers = self._get_headers()
        resp = await self._client.post(
            f"/v1/catalog/{server_id}/register", headers=headers
        )
        resp.raise_for_status()
        return resp.json()

    async def disconnect_catalog_server(self, server_id: str, gateway_id: str) -> dict:
        """Unregister / delete a gateway to disconnect a catalog server.

        Maps to: DELETE /gateways/{gateway_id}
        """
        headers = self._get_headers()
        resp = await self._client.delete(
            f"/gateways/{gateway_id}", headers=headers
        )
        resp.raise_for_status()
        return resp.json()

    # ── Tool Invocation ──────────────────────────────────────────

    async def invoke_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict:
        """Invoke a tool via JSON-RPC.

        Maps to: POST /rpc
        """
        headers = self._get_headers()
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        resp = await self._client.post("/rpc", json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()

    # ── Prompts ──────────────────────────────────────────────────

    async def list_prompts(self) -> list[dict]:
        """List all prompts."""
        headers = self._get_headers()
        resp = await self._client.get("/prompts", headers=headers, params={"include_pagination": "false", "limit": "0"})
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("prompts", [])

    # ── Resources ────────────────────────────────────────────────

    async def list_resources(self) -> list[dict]:
        """List all resources."""
        headers = self._get_headers()
        resp = await self._client.get("/resources", headers=headers, params={"include_pagination": "false", "limit": "0"})
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("resources", [])

    # ── Version ──────────────────────────────────────────────────

    async def get_version(self) -> dict:
        """Get ContextForge version info."""
        headers = self._get_headers()
        resp = await self._client.get("/version", headers=headers)
        resp.raise_for_status()
        return resp.json()

    # ── Cleanup ──────────────────────────────────────────────────

    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()
