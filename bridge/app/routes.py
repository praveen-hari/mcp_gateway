"""Bridge API routes — your client app calls these, NOT ContextForge directly.

This version talks directly to the running ContextForge gateway.
In production, add your own DB layer for tenant/user mappings.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .cf_client import ContextForgeClient
from .config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# ── Singleton CF client ──────────────────────────────────────────

_cf_client: ContextForgeClient | None = None


def get_cf_client() -> ContextForgeClient:
    global _cf_client
    if _cf_client is None:
        _cf_client = ContextForgeClient()
    return _cf_client


# ── Schemas ──────────────────────────────────────────────────────


class GatewayCreate(BaseModel):
    name: str
    url: str
    transport: str = "STREAMABLEHTTP"
    description: str = ""


class ServerCreate(BaseModel):
    name: str
    description: str = ""
    tool_ids: list[str] = []


class ToolInvoke(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = {}


class TeamCreate(BaseModel):
    name: str
    slug: str = ""
    description: str = ""


# ── Teams ────────────────────────────────────────────────────────


@router.get("/teams")
async def list_teams(cf: ContextForgeClient = Depends(get_cf_client)):
    """List all teams (tenants)."""
    try:
        return await cf.list_teams()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/teams")
async def create_team(body: TeamCreate, cf: ContextForgeClient = Depends(get_cf_client)):
    """Create a new team."""
    try:
        return await cf.create_team(name=body.name, slug=body.slug or None)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Dashboard ────────────────────────────────────────────────────


@router.get("/dashboard")
async def get_dashboard(team_id: str | None = None, cf: ContextForgeClient = Depends(get_cf_client)):
    """Aggregated dashboard data, optionally scoped to a team."""
    try:
        health = await cf.health_check()
    except Exception:
        health = {"status": "unreachable"}

    try:
        gateways = await cf.list_gateways(team_id=team_id)
    except Exception:
        gateways = []

    try:
        tools = await cf.list_tools(team_id=team_id)
    except Exception:
        tools = []

    try:
        servers = await cf.list_servers()
    except Exception:
        servers = []

    try:
        prompts = await cf.list_prompts()
    except Exception:
        prompts = []

    try:
        resources = await cf.list_resources()
    except Exception:
        resources = []

    return {
        "health": health,
        "team_id": team_id,
        "counts": {
            "gateways": len(gateways),
            "tools": len(tools),
            "servers": len(servers),
            "prompts": len(prompts),
            "resources": len(resources),
        },
        "gateway_status": health.get("status", "unknown"),
    }


@router.get("/health")
async def bridge_health(cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        cf_health = await cf.health_check()
        cf_status = "healthy"
    except Exception as e:
        cf_health = {"error": str(e)}
        cf_status = "unreachable"
    return {"bridge": "healthy", "contextforge": cf_status, "details": cf_health}


@router.get("/version")
async def get_version(cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.get_version()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ContextForge unreachable: {e}")


# ── Gateways ─────────────────────────────────────────────────────


@router.get("/gateways")
async def list_gateways(team_id: str | None = None, cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.list_gateways(team_id=team_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/gateways")
async def register_gateway(body: GatewayCreate, team_id: str | None = None, cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.register_gateway(name=body.name, url=body.url, transport=body.transport, description=body.description, team_id=team_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Tools ────────────────────────────────────────────────────────


@router.get("/tools")
async def list_tools(gateway_id: str | None = None, team_id: str | None = None, cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.list_tools(gateway_id=gateway_id, team_id=team_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/tools/invoke")
async def invoke_tool(body: ToolInvoke, cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.invoke_tool(body.tool_name, body.arguments)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Virtual Servers ──────────────────────────────────────────────


@router.get("/servers")
async def list_servers(cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.list_servers()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/servers")
async def create_server(body: ServerCreate, cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.create_virtual_server(name=body.name, description=body.description, tool_ids=body.tool_ids)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Prompts & Resources ─────────────────────────────────────────


@router.get("/prompts")
async def list_prompts(cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.list_prompts()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/resources")
async def list_resources(cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.list_resources()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/catalog")
async def get_catalog(cf: ContextForgeClient = Depends(get_cf_client)):
    try:
        return await cf.get_catalog()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/catalog/{server_id}/connect")
async def connect_catalog_server(server_id: str, cf: ContextForgeClient = Depends(get_cf_client)):
    """Connect a catalog server — registers it as a gateway in ContextForge."""
    try:
        return await cf.connect_catalog_server(server_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/catalog/{server_id}/disconnect")
async def disconnect_catalog_server(
    server_id: str,
    gateway_id: str,
    cf: ContextForgeClient = Depends(get_cf_client),
):
    """Disconnect a catalog server — removes its gateway registration."""
    try:
        return await cf.disconnect_catalog_server(server_id, gateway_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
