import { ConversationMomentumTracker } from "./ConversationMomentumTracker";
import { ResponseArchitecturePlanner } from "./ResponseArchitecturePlanner";
import { HumanResponsePlanner } from "./HumanResponsePlanner";
import { CognitionTelemetry } from "./CognitionTelemetry";
import { ResponseEndingPlanner } from "./ResponseEndingPlanner";
import { HumanExpressionEngine } from "../humanExpression/HumanExpressionEngine";
import { BehaviorAnalysis } from "@/lib/behavior-client";
import type { SenseEvidenceV1 } from "@/sense/SenseManager/types";
import { HumanStateModel } from "../humanState/HumanStateModel";
import type { HumanState } from "../humanState/HumanStateTypes";
import { AdaptiveCommunicationAnalyzer } from "../language/AdaptiveCommunicationAnalyzer";
import type { AdaptiveCommunicationProfile } from "../language/AdaptiveCommunicationProfile";
import type { ExecutionPlan } from "@/executive/ExecutionPlan";

/**
 * Evidence is only surfaced to the model when it carries meaningful signal.
 * Sub-threshold observations (e.g. an idle sense reporting "nothing happening")
 * are filtered here — absence of evidence remains absence of evidence.
 */
const MIN_EVIDENCE_CONFIDENCE = 0.5;
const MAX_EVIDENCE_PAYLOAD_CHARS = 400;

export class ConversationInterpreter {
  private static instance: ConversationInterpreter;

  private momentumTracker = new ConversationMomentumTracker();
  private architecturePlanner = new ResponseArchitecturePlanner();
  private humanPlanner = new HumanResponsePlanner();
  private endingPlanner = new ResponseEndingPlanner();
  private humanStateModel = new HumanStateModel();

  private constructor() {}

  public static getInstance() {
    if (!this.instance) this.instance = new ConversationInterpreter();
    return this.instance;
  }

  public processTurn(
    userText: string,
    backendBehavior: BehaviorAnalysis | null,
    senseEvidence: SenseEvidenceV1[] = [],
    plan?: ExecutionPlan,
  ): string {
    // 1. Extract backend intelligence (or degrade gracefully)
    const intent = backendBehavior?.act || "Exploring ideas";
    const state = backendBehavior?.emotional_state || "Casual chatting";
    const agreement =
      backendBehavior?.frustration && backendBehavior.frustration > 0.5 ? "Challenge" : "Agreement";
    const perspective =
      backendBehavior?.sensing_state?.mode === "supportive" ? "Support" : "Stay neutral";

    // 2. Track frontend momentum
    const { momentum, depth } = this.momentumTracker.update(userText);

    // 3. Plan frontend execution architecture
    const architecture = this.architecturePlanner.selectArchitecture(intent, state, momentum);
    const ending = this.endingPlanner.plan(intent, momentum);
    const evidenceBlock = this.formatSenseEvidence(senseEvidence);

    CognitionTelemetry.getInstance().log({
      state,
      architecture,
      agreement,
      perspective,
      momentum,
      depth,
      reasoningDepth: architecture.includes("Reasoning") ? "Deep" : "Surface",
      ending,
      evidenceCount: senseEvidence.length,
      evidenceSources: senseEvidence.map((e) => e.source),
    });

    // 3.5. Update Human State Hypotheses
    // Provide some minimal linguistic sentiment mapping based on behavior analysis
    const sentiment = backendBehavior?.emotional_state?.includes("frustration") ? -1 : 0;
    const humanState = this.humanStateModel.processEvidence(senseEvidence, {
      currentTurnText: userText,
      sentiment: sentiment,
      isTurnComplete: true
    });
    const humanStateBlock = this.formatHumanState(humanState);

    // 3.75 Format Adaptive Communication Profile
    const adaptiveProfile = AdaptiveCommunicationAnalyzer.getInstance().getProfile();
    const adaptiveBlock = this.formatAdaptiveProfile(adaptiveProfile);

    // 3.8 Format Central Cognitive Context (Memory & Identity)
    let memoryBlock = "";
    let identityBlock = "";

    if (plan) {
      if (plan.memoryPolicy !== "Ignore" && plan.memoryContent.length > 0) {
        memoryBlock = `\n[RELEVANT MEMORY]\n${plan.memoryContent.join("\n")}\n[/RELEVANT MEMORY]\n`;
      }
      
      const identity = plan.context.userIdentity;
      const identityLines = [];
      if (identity.preferredName) identityLines.push(`- Name: ${identity.preferredName}`);
      if (identity.stableFacts.length > 0) identityLines.push(`- Facts: ${identity.stableFacts.join(", ")}`);
      if (identity.preferences.length > 0) identityLines.push(`- Preferences: ${identity.preferences.join(", ")}`);
      if (identity.interests.length > 0) identityLines.push(`- Interests: ${identity.interests.join(", ")}`);
      if (identity.goals.length > 0) identityLines.push(`- Goals: ${identity.goals.join(", ")}`);
      
      if (identityLines.length > 0) {
        identityBlock = `\n[USER IDENTITY]\n${identityLines.join("\n")}\n[/USER IDENTITY]\n`;
      }
    }

    // 4. Format Cognitive Execution Block
    const cogBlock = this.humanPlanner.formatCognitiveBlock(
      intent,
      state,
      agreement,
      perspective,
      architecture,
      ending,
      depth,
    );

    // 5. Apply Human Expression Timing
    const exprBlock = HumanExpressionEngine.getInstance().evaluateExpression(
      userText,
      state,
      intent,
    );

    // Evidence is injected between cognition and expression. With no evidence
    // the block is empty — the result is byte-identical to the pre-wiring path.
    return cogBlock + identityBlock + memoryBlock + evidenceBlock + humanStateBlock + adaptiveBlock + exprBlock;
  }

  /**
   * Renders the Adaptive Communication Profile to steer the model's language and tone seamlessly.
   */
  private formatAdaptiveProfile(profile: AdaptiveCommunicationProfile): string {
    if (profile.profileMaturity < 0.3) return ""; // Wait for at least 1 reliable turn

    const langPref = profile.preferences.preferredResponseLanguage;
    const tone = Object.entries(profile.tone)
      .filter(([_, val]) => val > 0.6)
      .map(([key, _]) => key)
      .join(", ");

    const lines = [
      `- Target Language: ${langPref.toUpperCase()}`,
      `- Tone/Style: ${tone || "balanced"}`,
      `- Verbosity: ${profile.style.verbosity}`,
      profile.language.codeSwitching > 0.3 ? `- Note: Mirror user's code-switching as a natural behavioral preference.` : "",
    ].filter(Boolean);

    return `\n[ADAPTIVE COMMUNICATION PROFILE]\n${lines.join("\n")}\n[/ADAPTIVE COMMUNICATION PROFILE]\n`;
  }

  /**
   * Renders the probabilistic human state hypotheses into the cognitive prompt.
   */
  private formatHumanState(state: HumanState): string {
    if (state.affective.hypotheses.length === 0) return "";

    const lines = state.affective.hypotheses
      .filter(h => h.confidence > 0.3) // Only surface meaningful hypotheses to cognition
      .map(h => {
        let text = `- Hypothesis: ${h.type} (confidence: ${h.confidence.toFixed(2)})`;
        if (h.supportingEvidence.length > 0) {
          text += `\n  Supporting: ${h.supportingEvidence.join(", ")}`;
        }
        if (h.contradictingEvidence.length > 0) {
          text += `\n  Contradicting: ${h.contradictingEvidence.join(", ")}`;
        }
        return text;
      });

    if (lines.length === 0) return "";
    return `\n[HUMAN STATE (PROBABILISTIC)]\n${lines.join("\n")}\n[/HUMAN STATE]\n`;
  }

  /**
   * Renders fused sense evidence into a bounded, model-readable block.
   * Only meaningful evidence (confidence >= MIN_EVIDENCE_CONFIDENCE) is rendered;
   * returns "" when nothing qualifies, keeping the no-evidence path identical.
   */
  private formatSenseEvidence(senseEvidence: SenseEvidenceV1[]): string {
    const meaningful = senseEvidence.filter((e) => {
      if (e.confidence >= MIN_EVIDENCE_CONFIDENCE) return true;
      if (e.temporal?.features.includes("sudden_change")) return true;
      if (e.temporal?.features.includes("decreasing") && e.temporal.deviation !== undefined && e.temporal.deviation <= -0.2) return true;
      return false;
    });

    if (meaningful.length === 0) return "";

    const lines = meaningful.map((e) => {
      let payload = "{}";
      try {
        const serialized = JSON.stringify(e.payload);
        if (serialized) {
          payload =
            serialized.length > MAX_EVIDENCE_PAYLOAD_CHARS
              ? serialized.slice(0, MAX_EVIDENCE_PAYLOAD_CHARS) + "…"
              : serialized;
        }
      } catch {
        // Circular or non-serializable payload — keep the placeholder.
      }
      
      let temporalStr = "";
      if (e.temporal) {
        const feats = e.temporal.features.length > 0 ? ` [${e.temporal.features.join(", ")}]` : "";
        const dev = e.temporal.deviation !== undefined ? ` (dev: ${e.temporal.deviation > 0 ? '+' : ''}${e.temporal.deviation.toFixed(2)})` : "";
        temporalStr = `${feats}${dev}`;
      }
      
      return `- [${e.source}] confidence ${e.confidence.toFixed(2)}${temporalStr}: ${payload}`;
    });

    return `\n[SENSE EVIDENCE]\n${lines.join("\n")}\n[/SENSE EVIDENCE]\n`;
  }
}
