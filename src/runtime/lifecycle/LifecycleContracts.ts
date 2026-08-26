export enum IdleState {
  ACTIVE = "ACTIVE",
  WAITING = "WAITING",
  IDLE_WARNING = "IDLE_WARNING",
  TERMINATING = "TERMINATING",
  TERMINATED = "TERMINATED"
}

export interface RuntimeActivityState {
  isSpeaking: boolean;
  isThinking: boolean;
  isUserSpeaking: boolean;
  isRecovering: boolean;
  isBackgrounded: boolean;
}
