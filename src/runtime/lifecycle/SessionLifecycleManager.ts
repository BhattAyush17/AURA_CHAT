import { ConversationIdleSupervisor } from "./ConversationIdleSupervisor";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

export class SessionLifecycleManager {
  private supervisor = new ConversationIdleSupervisor();
  
  public startSession(
    sendWarning: (text: string) => void,
    endSession: () => void,
    activityProvider: () => any
  ) {
     RuntimeTelemetry.getInstance().logEvent({ subsystem: "LifecycleManager", severity: "info", data: { event: "IdleStarted" } });
     
     this.supervisor.start(
       () => {
         const act = activityProvider();
         return {
           isSpeaking: act.isSpeaking,
           isThinking: act.isThinking,
           isUserSpeaking: act.isActiveVoice,
           isRecovering: act.status === "connecting" || act.status === "reconnecting" || act.status === "disconnecting" || !!act.isRecovering,
           isBackgrounded: typeof document !== "undefined" ? document.visibilityState === "hidden" : false
         };
       },
       () => {
         sendWarning("I'm still here if you need me.");
       },
       () => {
         RuntimeTelemetry.getInstance().logEvent({ subsystem: "LifecycleManager", severity: "info", data: { event: "TerminationReason", reason: "timeout" } });
         
         // Trigger asynchronous memory consolidation for the Three-Tier UserModel
         // We do this 'fire-and-forget' style so it doesn't block UI termination.
         try {
           const sessionId = localStorage.getItem("aura_session_id") || "unknown_session";
           const userId = localStorage.getItem("aura_user_id") || "anonymous";
           import("@/lib/behavior-client").then((mod) => {
             const observations = mod.consumeObservationBuffer();
             fetch("http://localhost:8000/api/memory/consolidate", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({
                 session_id: sessionId,
                 user_id: userId,
                 observations: observations
               })
             }).catch(err => console.warn("[LifecycleManager] Consolidation failed:", err));
           });
         } catch (e) {
           console.warn("[LifecycleManager] Failed to trigger consolidation", e);
         }
         
         // Explicitly release microphone on idle timeout
         import("@/audioRuntime/MicrophoneCoordinator").then(({ MicrophoneCoordinator }) => {
           MicrophoneCoordinator.getInstance().releaseMicrophone();
         });
         
         endSession();
       }
     );
  }
  
  public ping() {
    this.supervisor.ping();
  }
  
  public dispose() {
    this.supervisor.dispose();
  }
}
