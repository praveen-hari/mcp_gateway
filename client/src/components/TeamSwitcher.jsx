import { useState } from "react";
import { useTeam } from "../context/TeamContext";
import { api } from "../api";

export function TeamSwitcher() {
  const { teams, activeTeam, switchTeam, loading, refetchTeams } = useTeam();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const team = await api.createTeam({
        name: newName.trim(),
        slug: newName.trim().toLowerCase().replace(/\s+/g, "-"),
      });
      await refetchTeams();
      switchTeam(team);
      setNewName("");
      setShowCreate(false);
      setOpen(false);
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="team-switcher-loading">Loading teams...</div>;

  return (
    <div className="team-switcher">
      <button className="team-switcher-btn" onClick={() => setOpen(!open)}>
        <span className="team-avatar">
          {activeTeam ? activeTeam.name.charAt(0).toUpperCase() : "★"}
        </span>
        <span className="team-switcher-name">
          {activeTeam ? activeTeam.name : "All Teams"}
        </span>
        <span className="team-switcher-arrow">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="team-dropdown">
          <div className="team-dropdown-header">Switch Team</div>

          {/* All Teams (admin view) */}
          <button
            className={`team-option ${!activeTeam ? "active" : ""}`}
            onClick={() => { switchTeam(null); setOpen(false); }}
          >
            <span className="team-option-avatar all">★</span>
            <div className="team-option-info">
              <div className="team-option-name">All Teams</div>
              <div className="team-option-desc">Global admin view</div>
            </div>
          </button>

          <div className="team-dropdown-divider" />

          {/* Team list */}
          {teams.map((team) => (
            <button
              key={team.id}
              className={`team-option ${activeTeam?.id === team.id ? "active" : ""}`}
              onClick={() => { switchTeam(team); setOpen(false); }}
            >
              <span className={`team-option-avatar ${team.is_personal ? "personal" : "org"}`}>
                {team.is_personal ? "👤" : team.name.charAt(0).toUpperCase()}
              </span>
              <div className="team-option-info">
                <div className="team-option-name">
                  {team.name}
                  {team.is_personal && <span className="team-badge personal">Personal</span>}
                  {team.visibility === "private" && !team.is_personal && (
                    <span className="team-badge private">Private</span>
                  )}
                </div>
                <div className="team-option-desc">
                  {team.member_count} member{team.member_count !== 1 ? "s" : ""}
                  {team.slug && ` · ${team.slug}`}
                </div>
              </div>
            </button>
          ))}

          <div className="team-dropdown-divider" />

          {/* Create team */}
          {showCreate ? (
            <form className="team-create-form" onSubmit={handleCreate}>
              <input
                autoFocus
                placeholder="Team name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <div className="team-create-actions">
                <button type="button" className="btn btn-sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating || !newName.trim()}>
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <button className="team-option create" onClick={() => setShowCreate(true)}>
              <span className="team-option-avatar create">+</span>
              <div className="team-option-info">
                <div className="team-option-name">Create New Team</div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
