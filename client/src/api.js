// Bridge API client — all calls go through the bridge backend, never directly to ContextForge
// Every team-scoped endpoint accepts an optional teamId parameter
const API_BASE = "http://localhost:8000/api";

function qs(params) {
  const p = Object.entries(params).filter(([, v]) => v != null && v !== "");
  return p.length ? "?" + new URLSearchParams(p).toString() : "";
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Teams
  listTeams: () => request("/teams"),
  createTeam: (data) =>
    request("/teams", { method: "POST", body: JSON.stringify(data) }),

  // Dashboard (team-scoped)
  getDashboard: (teamId) => request(`/dashboard${qs({ team_id: teamId })}`),
  getHealth: () => request("/health"),
  getVersion: () => request("/version"),

  // Gateways (team-scoped)
  listGateways: (teamId) => request(`/gateways${qs({ team_id: teamId })}`),
  registerGateway: (data, teamId) =>
    request(`/gateways${qs({ team_id: teamId })}`, { method: "POST", body: JSON.stringify(data) }),

  // Tools (team-scoped)
  listTools: (teamId, gatewayId) =>
    request(`/tools${qs({ team_id: teamId, gateway_id: gatewayId })}`),
  invokeTool: (toolName, args) =>
    request("/tools/invoke", {
      method: "POST",
      body: JSON.stringify({ tool_name: toolName, arguments: args }),
    }),

  // Servers
  listServers: () => request("/servers"),
  createServer: (data) =>
    request("/servers", { method: "POST", body: JSON.stringify(data) }),

  // Prompts & Resources
  listPrompts: () => request("/prompts"),
  listResources: () => request("/resources"),

  // Catalog
  getCatalog: () => request("/catalog"),
  connectCatalogServer: (serverId) =>
    request(`/catalog/${serverId}/connect`, { method: "POST" }),
  disconnectCatalogServer: (serverId, gatewayId) =>
    request(`/catalog/${serverId}/disconnect?gateway_id=${gatewayId}`, { method: "DELETE" }),
};
