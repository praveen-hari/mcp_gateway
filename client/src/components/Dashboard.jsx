import { useApi } from "../hooks/useApi";
import { api } from "../api";
import { StatusBadge } from "./StatusBadge";
import { useTeam } from "../context/TeamContext";

export function Dashboard() {
  const { teamId, activeTeam } = useTeam();
  const { data, loading, error, refetch } = useApi(() => api.getDashboard(teamId), [teamId]);

  if (loading) return <div className="loading">Loading dashboard...</div>;
  if (error) return <div className="error-box">Error: {error}</div>;

  const { health, counts, gateway_status } = data;

  return (
    <div className="dashboard">
      <div className="section-header">
        <h2>📊 Overview</h2>
        <button className="btn btn-sm" onClick={refetch}>↻ Refresh</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🖥️</div>
          <div className="stat-value">{counts.gateways}</div>
          <div className="stat-label">MCP Servers</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🛠️</div>
          <div className="stat-value">{counts.tools}</div>
          <div className="stat-label">Tools</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔗</div>
          <div className="stat-value">{counts.servers}</div>
          <div className="stat-label">Virtual Servers</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💬</div>
          <div className="stat-value">{counts.prompts}</div>
          <div className="stat-label">Prompts</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📁</div>
          <div className="stat-value">{counts.resources}</div>
          <div className="stat-label">Resources</div>
        </div>
      </div>

      <div className="info-card">
        <h3>Gateway Status</h3>
        <p>ContextForge: <StatusBadge status={gateway_status} /></p>
        <p className="muted">
          Runtime: {health?.mcp_runtime?.mode || "unknown"} &middot;
          Cluster: {health?.mcp_runtime?.cluster_propagation || "N/A"}
          {activeTeam && <> &middot; Team: <strong>{activeTeam.name}</strong></>}
        </p>
      </div>
    </div>
  );
}
