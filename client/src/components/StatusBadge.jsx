export function StatusBadge({ status }) {
  const colors = {
    healthy: "badge-success",
    unreachable: "badge-danger",
    error: "badge-danger",
    connected: "badge-success",
    connecting: "badge-warning",
    not_connected: "badge-secondary",
    unknown: "badge-secondary",
  };
  return (
    <span className={`badge ${colors[status] || "badge-secondary"}`}>
      {status}
    </span>
  );
}
