import { useState } from "react";
import "./App.css";
import { TeamProvider, useTeam } from "./context/TeamContext";
import { TeamSwitcher } from "./components/TeamSwitcher";
import { Dashboard } from "./components/Dashboard";
import { Gateways } from "./components/Gateways";
import { Tools } from "./components/Tools";
import { Servers } from "./components/Servers";
import { VersionInfo } from "./components/VersionInfo";
import { Catalog } from "./components/Catalog";

const NAV_ITEMS = [
  { id: "dashboard", label: "📊 Overview", component: Dashboard },
  { id: "catalog", label: "📦 Catalog", component: Catalog },
  { id: "gateways", label: "🖥️ MCP Servers", component: Gateways },
  { id: "tools", label: "🛠️ Tools", component: Tools },
  { id: "servers", label: "🔗 Virtual Servers", component: Servers },
  { id: "version", label: "ℹ️ System Info", component: VersionInfo },
];

function AppContent() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const { activeTeam } = useTeam();
  const ActiveComponent =
    NAV_ITEMS.find((n) => n.id === activeTab)?.component || Dashboard;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">⚡</span>
          <div>
            <div className="brand-title">MCP Gateway</div>
            <div className="brand-subtitle">Client Console</div>
          </div>
        </div>

        {/* Team Switcher */}
        <TeamSwitcher />

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="muted">Powered by</div>
          <a
            href="https://github.com/IBM/mcp-context-forge"
            target="_blank"
            rel="noopener"
          >
            ContextForge v1.0.9
          </a>
        </div>
      </aside>
      <main className="main-content">
        {/* Team context banner */}
        {activeTeam && (
          <div className="team-banner">
            <span className="team-banner-icon">
              {activeTeam.is_personal ? "👤" : "🏢"}
            </span>
            <span>
              Viewing as <strong>{activeTeam.name}</strong>
            </span>
            {activeTeam.visibility === "private" && (
              <span className="team-badge private">Private</span>
            )}
          </div>
        )}
        <ActiveComponent />
      </main>
    </div>
  );
}

function App() {
  return (
    <TeamProvider>
      <AppContent />
    </TeamProvider>
  );
}

export default App;
