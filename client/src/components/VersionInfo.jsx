import { useApi } from "../hooks/useApi";
import { api } from "../api";

export function VersionInfo() {
  const { data, loading, error } = useApi(api.getVersion);

  if (loading) return <div className="loading">Loading version...</div>;
  if (error) return <div className="error-box">Error: {error}</div>;

  const app = data?.app || {};
  const platform = data?.platform || {};
  const db = data?.database || {};
  const redis = data?.redis || {};
  const system = data?.system || {};

  return (
    <div>
      <h2>ℹ️ System Info</h2>

      <div className="info-grid">
        <div className="info-card">
          <h3>🚀 Application</h3>
          <dl>
            <dt>Name</dt><dd>{app.name}</dd>
            <dt>Version</dt><dd>{app.version}</dd>
            <dt>MCP Protocol</dt><dd>{app.mcp_protocol_version}</dd>
          </dl>
        </div>

        <div className="info-card">
          <h3>⚙️ Platform</h3>
          <dl>
            <dt>Python</dt><dd>{platform.python}</dd>
            <dt>FastAPI</dt><dd>{platform.fastapi}</dd>
            <dt>SQLAlchemy</dt><dd>{platform.sqlalchemy}</dd>
            <dt>OS</dt><dd>{platform.os}</dd>
          </dl>
        </div>

        <div className="info-card">
          <h3>🗄️ Database</h3>
          <dl>
            <dt>Dialect</dt><dd>{db.dialect}</dd>
            <dt>Server</dt><dd>{db.server_version}</dd>
            <dt>Reachable</dt><dd>{db.reachable ? "✅" : "❌"}</dd>
          </dl>
        </div>

        <div className="info-card">
          <h3>📊 Redis</h3>
          <dl>
            <dt>Available</dt><dd>{redis.available ? "✅" : "❌"}</dd>
            <dt>Version</dt><dd>{redis.server_version}</dd>
            <dt>Reachable</dt><dd>{redis.reachable ? "✅" : "❌"}</dd>
          </dl>
        </div>

        <div className="info-card">
          <h3>💻 System</h3>
          <dl>
            <dt>CPU</dt><dd>{system.cpu_count} cores ({system.cpu_percent}%)</dd>
            <dt>Memory</dt><dd>{system.mem_used_mb}MB / {system.mem_total_mb}MB</dd>
            <dt>Disk</dt><dd>{system.disk_used_gb}GB / {system.disk_total_gb}GB</dd>
            <dt>Process RSS</dt><dd>{system.process?.rss_mb}MB</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
