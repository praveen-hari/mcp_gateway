import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { api } from "../api";
import { StatusBadge } from "./StatusBadge";
import { useTeam } from "../context/TeamContext";

export function Gateways() {
  const { teamId } = useTeam();
  const { data: gateways, loading, error, refetch } = useApi(() => api.listGateways(teamId), [teamId]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", transport: "STREAMABLEHTTP", description: "" });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.registerGateway(form);
      setForm({ name: "", url: "", transport: "STREAMABLEHTTP", description: "" });
      setShowForm(false);
      refetch();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading">Loading gateways...</div>;
  if (error) return <div className="error-box">Error: {error}</div>;

  return (
    <div>
      <div className="section-header">
        <h2>🖥️ MCP Servers (Gateways)</h2>
        <div>
          <button className="btn btn-sm" onClick={refetch}>↻</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Register"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-mcp-server" />
          </div>
          <div className="form-group">
            <label>URL</label>
            <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:9000/mcp" />
          </div>
          <div className="form-group">
            <label>Transport</label>
            <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
              <option value="STREAMABLEHTTP">Streamable HTTP</option>
              <option value="SSE">SSE</option>
              <option value="STDIO">STDIO</option>
              <option value="WEBSOCKET">WebSocket</option>
            </select>
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Registering..." : "Register Gateway"}
          </button>
        </form>
      )}

      {gateways.length === 0 ? (
        <div className="empty-state">
          <p>No MCP servers registered yet.</p>
          <p className="muted">Click "+ Register" to add an upstream MCP server.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Transport</th>
                <th>Status</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {gateways.map((gw) => (
                <tr key={gw.id}>
                  <td><strong>{gw.name}</strong></td>
                  <td className="muted mono">{gw.url}</td>
                  <td>{gw.transport || gw.request_type || "—"}</td>
                  <td><StatusBadge status={gw.enabled !== false ? "healthy" : "error"} /></td>
                  <td className="muted mono">{gw.id?.slice(0, 8)}...</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
