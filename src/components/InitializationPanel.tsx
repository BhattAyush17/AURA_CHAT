import { motion, AnimatePresence } from "framer-motion";
import { Settings, RotateCcw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { ReadinessSnapshot, MilestoneStatus } from "@/providers/gemini-next/SessionReadinessManager";

interface InitializationPanelProps {
  snapshot: ReadinessSnapshot;
  onRetry: () => void;
  onSettings: () => void;
}

const statusIcon = (status: MilestoneStatus) => {
  switch (status) {
    case "complete":
      return (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="init-icon init-icon-done"
        >
          <CheckCircle2 className="w-4 h-4" />
        </motion.span>
      );
    case "in_progress":
      return (
        <span className="init-icon init-icon-active">
          <Loader2 className="w-4 h-4 animate-spin" />
        </span>
      );
    case "failed":
      return (
        <motion.span
          initial={{ x: -4 }}
          animate={{ x: [0, -3, 3, -2, 2, 0] }}
          transition={{ duration: 0.4 }}
          className="init-icon init-icon-failed"
        >
          <XCircle className="w-4 h-4" />
        </motion.span>
      );
    default:
      return <span className="init-icon init-icon-waiting">○</span>;
  }
};

export function InitializationPanel({ snapshot, onRetry, onSettings }: InitializationPanelProps) {
  const isFailed = snapshot.overall === "failed";
  const isReady = snapshot.overall === "ready";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="init-panel"
    >
      {/* Title */}
      <div className="init-header">
        <AnimatePresence mode="wait">
          {isReady ? (
            <motion.span
              key="ready"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="init-title init-title-ready"
            >
              ✓ AURA is ready
            </motion.span>
          ) : isFailed ? (
            <motion.span
              key="failed"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="init-title init-title-failed"
            >
              AURA couldn't start
            </motion.span>
          ) : (
            <motion.span
              key="preparing"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="init-title"
            >
              Preparing AURA…
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Milestones */}
      <ul className="init-milestones">
        {snapshot.milestones.map((m) => (
          <motion.li
            key={m.id}
            layout
            className={`init-milestone ${m.status === "failed" ? "init-milestone-failed" : ""} ${m.status === "complete" ? "init-milestone-done" : ""}`}
          >
            {statusIcon(m.status)}
            <span className="init-milestone-label">{m.label}</span>
          </motion.li>
        ))}
      </ul>

      {/* Error detail */}
      <AnimatePresence>
        {isFailed && snapshot.errorMessage && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="init-error-msg"
          >
            {snapshot.errorMessage}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Progress bar (only while initializing) */}
      {!isFailed && !isReady && (
        <div className="init-progress-track">
          <motion.div
            className="init-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(snapshot.progress * 100)}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      )}

      {/* Current operation */}
      {!isFailed && !isReady && (
        <p className="init-operation">{snapshot.currentOperation}</p>
      )}

      {/* Actions on failure */}
      {isFailed && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="init-actions"
        >
          <button onClick={onRetry} className="init-btn-retry">
            <RotateCcw className="w-3.5 h-3.5" />
            Retry
          </button>
          <button onClick={onSettings} className="init-btn-settings">
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
