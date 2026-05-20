export type WSState = "IDLE" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "CLOSING" | "CLOSED";

const LEGAL_TRANSITIONS: Record<WSState, WSState[]> = {
  IDLE: ["CONNECTING"],
  CONNECTING: ["CONNECTED", "RECONNECTING", "CLOSED"],
  CONNECTED: ["CLOSING", "RECONNECTING", "CLOSED"],
  RECONNECTING: ["CONNECTING", "CLOSED", "IDLE"],
  CLOSING: ["CLOSED"],
  CLOSED: ["IDLE", "CONNECTING"],
};

export function transition(from: WSState, to: WSState): WSState {
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal WS transition: ${from} → ${to}`);
  }
  return to;
}
