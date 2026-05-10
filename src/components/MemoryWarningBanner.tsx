import { dismissMemoryWarning } from "@/lib/sync-meta";

interface Props {
  userId: string;
  message: string;
  onDismiss: () => void;
}

export function MemoryWarningBanner({ userId, message, onDismiss }: Props) {
  function handleDismiss() {
    dismissMemoryWarning(userId);
    onDismiss();
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(26, 26, 46, 0.95)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(245, 158, 11, 0.5)",
        borderRadius: "12px",
        padding: "0.875rem 1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1.5rem",
        zIndex: 100,
        maxWidth: "520px",
        width: "calc(100% - 2rem)",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.25rem" }}>⚠</span>
        <span style={{ color: "#fbbf24", fontSize: "0.8125rem", fontWeight: 500, lineHeight: 1.4 }}>
          {message}
        </span>
      </div>
      <button
        onClick={handleDismiss}
        style={{
          color: "#9ca3af",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "6px",
          padding: "0.375rem 0.75rem",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.2s ease",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = "#ffffff";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = "#9ca3af";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
