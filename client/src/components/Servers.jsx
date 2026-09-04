import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { api } from "../api";

export function Servers() {
  const { data: servers, loading, error, refetch } = useApi(api.listServers);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", tool_ids: "" });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const toolIds = form.tool_ids.split(",").map((s) => s.trim()).filter(Boolean);
      await api.createServer({ name: form.name, description: form.description, tool_ids: toolIds });
      setForm({ name: "", description: "", tool_ids: "" });
      setShowForm(false);
      refetch();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading">Loading servers...</div>;
  if (error) return <div className="error-box">Error: {error}</div>;

  return (
    <div>
      <div className="section-header">
        <h2>🔗 Virtual Servers</h2>
        <div>
          <button className="btn btn-sm" onClick={refetch}>↻</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Create"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-server" />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Server description" />
          </div>
          <div className="form-group">
            <label>Tool IDs (comma-separated)</label>
            <input value={form.tool_ids} onChange={(e) => setForm({ ...form, tool_ids: e.target.value })} placeholder="tool-id-1, tool-id-2" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Server"}
          </button>
        </form>
      )}

      {servers.length === 0 ? (
        <div className="empty-state">
          <p>No virtual servers created yet.</p>
          <p className="muted">Create a virtual server to bundle tools into a unified MCP endpoint.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Tools</th>
                <th>MCP Endpoint</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="muted">{s.description || "—"}</td>
                  <td>{s.associatedTools?.length || s.associated_tools?.length || 0}</td>
                  <td className="mono muted">/servers/{s.id?.slice(0, 8)}…/mcp</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
