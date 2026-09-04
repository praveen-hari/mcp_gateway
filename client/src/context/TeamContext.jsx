import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api";

const TeamContext = createContext(null);

export function TeamProvider({ children }) {
  const [teams, setTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null); // null = "All Teams" (admin view)
  const [loading, setLoading] = useState(true);

  const fetchTeams = useCallback(async () => {
    try {
      const data = await api.listTeams();
      setTeams(data);
    } catch (err) {
      console.error("Failed to load teams:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const switchTeam = useCallback((team) => {
    setActiveTeam(team); // null for "All Teams"
  }, []);

  const teamId = activeTeam?.id || null;

  return (
    <TeamContext.Provider value={{ teams, activeTeam, teamId, switchTeam, loading, refetchTeams: fetchTeams }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
