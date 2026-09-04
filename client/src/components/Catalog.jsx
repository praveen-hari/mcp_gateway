import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";
import { api } from "../api";

const CF_BASE = "http://localhost:4444";

// Category icons mapping
const CATEGORY_ICONS = {
  "Software Development": "💻",
  "Project Management": "📋",
  Productivity: "⚡",
  Payments: "💳",
  CRM: "👥",
  "Data Analytics": "📊",
  Cloud: "☁️",
  Database: "🗄️",
  Travel: "✈️",
  Search: "🔍",
  Security: "🔒",
  "AI Services": "🤖",
  "Customer Support": "🎧",
  Design: "🎨",
  Marketing: "📣",
  "RAG-as-a-Service": "📚",
  Documentation: "📝",
  Observability: "📈",
  "Document Management": "📄",
  CMS: "🌐",
  Automation: "⚙️",
  "E-Commerce": "🛒",
  Authentication: "🔑",
  Recruitment: "🧑‍💼",
  "Social Media": "📱",
  Other: "📦",
};

export function Catalog() {
  const { data: catalog, loading, error, refetch } = useApi(api.getCatalog);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [connecting, setConnecting] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);

  // Extract unique categories
  const categories = useMemo(() => {
    if (!catalog) return [];
    const cats = [...new Set(catalog.map((s) => s.category))].sort();
    return ["All", ...cats];
  }, [catalog]);

  // Filter catalog
  const filtered = useMemo(() => {
    if (!catalog) return [];
    return catalog.filter((s) => {
      const matchesSearch =
        !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description?.toLowerCase().includes(search.toLowerCase()) ||
        s.provider?.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        categoryFilter === "All" || s.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [catalog, search, categoryFilter]);

  const handleConnect = async (server) => {
    setConnecting(server.id);
    try {
      await api.connectCatalogServer(server.id);
      refetch();
    } catch (err) {
      alert(`Failed to connect ${server.name}: ${err.message}`);
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (server) => {
    if (!confirm(`Disconnect ${server.name}? This will remove the gateway.`))
      return;
    setDisconnecting(server.id);
    try {
      await api.disconnectCatalogServer(server.id, server.gateway_id);
      refetch();
    } catch (err) {
      alert(`Failed to disconnect ${server.name}: ${err.message}`);
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) return <div className="loading">Loading catalog...</div>;
  if (error) return <div className="error-box">Error: {error}</div>;

  const connectedCount = catalog.filter((s) => s.is_registered).length;

  return (
    <div className="catalog-page">
      <div className="section-header">
        <h2>📦 MCP Server Catalog</h2>
        <button className="btn btn-sm" onClick={refetch}>
          ↻ Refresh
        </button>
      </div>

      <p className="catalog-subtitle">
        {catalog.length} servers available &middot; {connectedCount} connected
      </p>

      {/* Filters */}
      <div className="catalog-filters">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search servers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="category-pills">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`pill ${categoryFilter === cat ? "active" : ""}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat !== "All" && (
                <span className="pill-icon">
                  {CATEGORY_ICONS[cat] || "📦"}
                </span>
              )}
              {cat}
              {cat === "All" && (
                <span className="pill-count">{catalog.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Server List */}
      <div className="catalog-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>No servers match your search.</p>
          </div>
        ) : (
          filtered.map((server) => (
            <div
              key={server.id}
              className={`catalog-item ${server.is_registered ? "connected" : ""}`}
            >
              <div className="catalog-item-icon">
                {server.logo_url ? (
                  <img
                    src={`${CF_BASE}${server.logo_url}`}
                    alt={server.name}
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextSibling.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  className="catalog-item-icon-fallback"
                  style={{ display: server.logo_url ? "none" : "flex" }}
                >
                  {CATEGORY_ICONS[server.category] || "📦"}
                </div>
              </div>

              <div className="catalog-item-info">
                <div className="catalog-item-name">
                  {server.name}
                  {server.is_registered && (
                    <span className="connected-badge">✓ Connected</span>
                  )}
                </div>
                <div className="catalog-item-desc">
                  {server.description || `${server.category} integration`}
                </div>
                <div className="catalog-item-meta">
                  <span className="tag">{server.category}</span>
                  {server.provider && server.provider !== server.name && (
                    <span className="tag">{server.provider}</span>
                  )}
                  {server.auth_type && (
                    <span className="tag">
                      {server.auth_type === "OAuth2.1"
                        ? "🔐 OAuth"
                        : server.auth_type === "Open"
                          ? "🔓 Open"
                          : `🔑 ${server.auth_type}`}
                    </span>
                  )}
                </div>
              </div>

              <div className="catalog-item-action">
                {server.is_registered ? (
                  <button
                    className="btn btn-disconnect"
                    onClick={() => handleDisconnect(server)}
                    disabled={disconnecting === server.id}
                  >
                    {disconnecting === server.id
                      ? "Disconnecting..."
                      : "Disconnect"}
                  </button>
                ) : (
                  <button
                    className="btn btn-connect"
                    onClick={() => handleConnect(server)}
                    disabled={connecting === server.id}
                  >
                    {connecting === server.id ? (
                      "Connecting..."
                    ) : (
                      <>
                        Connect <span className="arrow">↗</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
