/**
 * SessionReadinessManager
 *
 * Tracks the milestone-based initialization of a Gemini voice session.
 * Pure TypeScript — no React dependency. The UI subscribes via onUpdate().
 */

export type MilestoneStatus = "waiting" | "in_progress" | "complete" | "failed";

export type MilestoneId =
  | "credentials"
  | "microphone"
  | "audio_output"
  | "gemini_session"
  | "input_path"
  | "output_path";

export type OverallReadinessState = "idle" | "initializing" | "ready" | "failed";

export type ReadinessErrorCode =
  | "MISSING_CREDENTIAL"
  | "INVALID_CREDENTIAL"
  | "PERMISSION_DENIED"
  | "MICROPHONE_UNAVAILABLE"
  | "AUDIO_CONTEXT_FAILED"
  | "GEMINI_CONNECTION_FAILED"
  | "GEMINI_CONNECTION_TIMEOUT"
  | "GEMINI_HANDSHAKE_FAILED"
  | "PCM_CAPTURE_FAILED"
  | "PCM_CAPTURE_TIMEOUT"
  | "OUTPUT_INITIALIZATION_FAILED"
  | "UNKNOWN";

export interface MilestoneEntry {
  id: MilestoneId;
  label: string;
  status: MilestoneStatus;
  errorCode?: ReadinessErrorCode;
  errorMessage?: string;
}

export interface ReadinessSnapshot {
  overall: OverallReadinessState;
  milestones: MilestoneEntry[];
  currentOperation: string;
  progress: number;
  failedMilestone?: MilestoneId;
  errorCode?: ReadinessErrorCode;
  errorMessage?: string;
}

type UpdateListener = (snapshot: ReadinessSnapshot) => void;

const MILESTONE_DEFINITIONS: { id: MilestoneId; label: string }[] = [
  { id: "credentials", label: "Gemini credentials" },
  { id: "microphone", label: "Microphone" },
  { id: "audio_output", label: "Audio output" },
  { id: "gemini_session", label: "Gemini session" },
  { id: "input_path", label: "Voice input" },
  { id: "output_path", label: "Voice output" },
];

const MILESTONE_TIMEOUTS: Record<MilestoneId, number> = {
  credentials: 3000,
  microphone: 8000,
  audio_output: 5000,
  gemini_session: 10000,
  input_path: 5000,
  output_path: 3000,
};

const OPERATION_LABELS: Record<MilestoneId, string> = {
  credentials: "Checking Gemini credentials…",
  microphone: "Opening microphone…",
  audio_output: "Starting audio engine…",
  gemini_session: "Establishing Live session…",
  input_path: "Verifying voice input…",
  output_path: "Preparing response audio…",
};

const ERROR_MESSAGES: Record<ReadinessErrorCode, string> = {
  MISSING_CREDENTIAL: "Gemini API key is not configured.",
  INVALID_CREDENTIAL: "Your Gemini API key is invalid.",
  PERMISSION_DENIED: "Microphone permission was denied.",
  MICROPHONE_UNAVAILABLE: "No usable microphone was detected.",
  AUDIO_CONTEXT_FAILED: "The browser could not initialize audio.",
  GEMINI_CONNECTION_FAILED: "Could not connect to Gemini.",
  GEMINI_CONNECTION_TIMEOUT: "Gemini connection is taking too long.",
  GEMINI_HANDSHAKE_FAILED: "Gemini connected but the voice session could not be initialized.",
  PCM_CAPTURE_FAILED: "The microphone opened, but no audio data is being captured.",
  PCM_CAPTURE_TIMEOUT: "Microphone opened, but no audio data arrived in time.",
  OUTPUT_INITIALIZATION_FAILED: "The voice output could not be initialized.",
  UNKNOWN: "An unexpected error occurred.",
};

export class SessionReadinessManager {
  private milestones: Map<MilestoneId, MilestoneEntry>;
  private overall: OverallReadinessState = "idle";
  private currentOperation = "";
  private listeners = new Set<UpdateListener>();
  private timeoutHandles = new Map<MilestoneId, ReturnType<typeof setTimeout>>();

  constructor() {
    this.milestones = new Map();
    for (const def of MILESTONE_DEFINITIONS) {
      this.milestones.set(def.id, { id: def.id, label: def.label, status: "waiting" });
    }
  }

  public begin(): void {
    this.overall = "initializing";
    this.currentOperation = "Preparing AURA…";
    this.emit();
  }

  public markInProgress(id: MilestoneId): void {
    const m = this.milestones.get(id);
    if (!m || m.status === "complete" || m.status === "failed") return;
    m.status = "in_progress";
    this.currentOperation = OPERATION_LABELS[id] || `Initializing ${m.label}…`;
    this.startTimeout(id);
    this.emit();
  }

  public markComplete(id: MilestoneId): void {
    const m = this.milestones.get(id);
    if (!m) return;
    this.clearTimeout(id);
    m.status = "complete";
    m.errorCode = undefined;
    m.errorMessage = undefined;

    const allComplete = Array.from(this.milestones.values()).every((e) => e.status === "complete");
    if (allComplete) {
      this.overall = "ready";
      this.currentOperation = "Voice connection ready.";
    }
    this.emit();
  }

  public markFailed(id: MilestoneId, errorCode: ReadinessErrorCode, customMessage?: string): void {
    const m = this.milestones.get(id);
    if (!m) return;
    this.clearTimeout(id);
    m.status = "failed";
    m.errorCode = errorCode;
    m.errorMessage = customMessage || ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.UNKNOWN;
    this.overall = "failed";
    this.currentOperation = m.errorMessage;
    this.timeoutHandles.forEach((_, key) => this.clearTimeout(key));
    this.emit();
  }

  public getSnapshot(): ReadinessSnapshot {
    const entries = Array.from(this.milestones.values());
    const completedCount = entries.filter((e) => e.status === "complete").length;
    const failed = entries.find((e) => e.status === "failed");

    return {
      overall: this.overall,
      milestones: entries,
      currentOperation: this.currentOperation,
      progress: entries.length > 0 ? completedCount / entries.length : 0,
      failedMilestone: failed?.id,
      errorCode: failed?.errorCode,
      errorMessage: failed?.errorMessage,
    };
  }

  public onUpdate(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public reset(): void {
    this.timeoutHandles.forEach((_, key) => this.clearTimeout(key));
    this.overall = "idle";
    this.currentOperation = "";
    for (const def of MILESTONE_DEFINITIONS) {
      this.milestones.set(def.id, { id: def.id, label: def.label, status: "waiting" });
    }
    this.emit();
  }

  public dispose(): void {
    this.timeoutHandles.forEach((_, key) => this.clearTimeout(key));
    this.listeners.clear();
  }

  private startTimeout(id: MilestoneId): void {
    this.clearTimeout(id);
    const ms = MILESTONE_TIMEOUTS[id];
    if (!ms) return;

    const handle = setTimeout(() => {
      const m = this.milestones.get(id);
      if (m && m.status === "in_progress") {
        const timeoutCode = this.getTimeoutCode(id);
        this.markFailed(id, timeoutCode);
      }
    }, ms);
    this.timeoutHandles.set(id, handle);
  }

  private clearTimeout(id: MilestoneId): void {
    const handle = this.timeoutHandles.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timeoutHandles.delete(id);
    }
  }

  private getTimeoutCode(id: MilestoneId): ReadinessErrorCode {
    switch (id) {
      case "credentials": return "MISSING_CREDENTIAL";
      case "microphone": return "PCM_CAPTURE_TIMEOUT";
      case "audio_output": return "OUTPUT_INITIALIZATION_FAILED";
      case "gemini_session": return "GEMINI_CONNECTION_TIMEOUT";
      case "input_path": return "PCM_CAPTURE_FAILED";
      case "output_path": return "OUTPUT_INITIALIZATION_FAILED";
      default: return "UNKNOWN";
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        // swallow listener errors
      }
    });
  }
}
