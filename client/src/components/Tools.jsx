import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { api } from "../api";
import { useTeam } from "../context/TeamContext";

export function Tools() {
  const { teamId } = useTeam();
  const { data: tools, loading, error, refetch } = useApi(() => api.listTools(teamId), [teamId]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState(null);
  const [invoking, setInvoking] = useState(false);

  const handleInvoke = async () => {
    if (!selectedTool) return;
    setInvoking(true);
    setResult(null);
    try {
      const parsed = JSON.parse(args);
      const res = await api.invokeTool(selectedTool.name, parsed);
      setResult(res);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setInvoking(false);
    }
  };

  if (loading) return <div className="loading">Loading tools...</div>;
  if (error) return <div className="error-box">Error: {error}</div>;

  return (
    <div>
      <div className="section-header">
        <h2>🛠️ Tools</h2>
        <button className="btn btn-sm" onClick={refetch}>↻ Refresh</button>
      </div>

      {tools.length === 0 ? (
        <div className="empty-state">
          <p>No tools discovered yet.</p>
          <p className="muted">Register an MCP server first, then tools will be auto-discovered.</p>
        </div>
      ) : (
        <>
          <div className="tools-grid">
            {tools.map((tool) => (
              <div
                key={tool.id}
                className={`tool-card ${selectedTool?.id === tool.id ? "selected" : ""}`}
                onClick={() => { setSelectedTool(tool); setResult(null); }}
              >
                <div className="tool-name">{tool.name}</div>
                <div className="tool-desc">{tool.description || "No description"}</div>
                <div className="tool-meta">
                  {tool.gatewaySlug && <span className="tag">{tool.gatewaySlug}</span>}
                  {tool.integration_type && <span className="tag">{tool.integration_type}</span>}
                </div>
              </div>
            ))}
          </div>

          {selectedTool && (
            <div className="tool-invoke-panel">
              <h3>Invoke: {selectedTool.name}</h3>
              {selectedTool.description && <p className="muted">{selectedTool.description}</p>}

              {selectedTool.inputSchema && (
                <details className="schema-details">
                  <summary>Input Schema</summary>
                  <pre>{JSON.stringify(selectedTool.inputSchema, null, 2)}</pre>
                </details>
              )}

              <div className="form-group">
                <label>Arguments (JSON)</label>
                <textarea
                  rows={4}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder='{"param": "value"}'
                />
              </div>

              <button className="btn btn-primary" onClick={handleInvoke} disabled={invoking}>
                {invoking ? "Invoking..." : "▶ Invoke Tool"}
              </button>

              {result && (
                <div className="result-box">
                  <h4>Result</h4>
                  <pre>{JSON.stringify(result, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
