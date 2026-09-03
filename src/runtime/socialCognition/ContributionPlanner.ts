import type { AuraStance, ContributionType, ResponseMode, ConversationalMomentum } from "./SocialDecision";
import type { TrajectoryIntent } from "./SocialDecision";

export class ContributionPlanner {
  plan(
    auraStance: AuraStance,
    momentum: ConversationalMomentum,
    trajectory: TrajectoryIntent,
    purpose: string,
    userVulnerability: number,
    wordCount: number,
  ): { contribution: ContributionType; mode: ResponseMode } {
    // Storytelling mode → listen
    if (momentum.storytelling || trajectory === "story_continuation") {
      return { contribution: "reaction", mode: "listen" };
    }

    // User shared something emotional → reflect
    if (userVulnerability > 0.5 || trajectory === "emotional_elaboration") {
      return { contribution: "reflection", mode: "reflect" };
    }

    // Venting → acknowledge
    if (trajectory === "venting" || purpose === "venting") {
      return { contribution: "none", mode: "acknowledge" };
    }

    // Challenge stance → counterpoint
    if (auraStance === "challenge") {
      return { contribution: "counterpoint", mode: "challenge" };
    }

    // Alternative perspective → opinion
    if (auraStance === "alternative_perspective") {
      return { contribution: "opinion", mode: "respond" };
    }

    // Clarify → question/curiosity
    if (auraStance === "clarify") {
      return { contribution: "curiosity", mode: "ask" };
    }

    // User is decisive / opinion sharing → connection
    if (trajectory === "opinion_sharing") {
      return { contribution: "connection", mode: "respond" };
    }

    // Information seeking → answer
    if (trajectory === "information_seeking") {
      return { contribution: "information", mode: "respond" };
    }

    // Planning → observation
    if (trajectory === "planning") {
      return { contribution: "observation", mode: "respond" };
    }

    // Reflection → reflection
    if (trajectory === "reflection") {
      return { contribution: "reflection", mode: "reflect" };
    }

    // Acknowledge stance → none
    if (auraStance === "acknowledge") {
      return { contribution: "none", mode: "acknowledge" };
    }

    // Default
    if (momentum.user_wants_space) {
      return { contribution: "none", mode: "listen" };
    }

    return { contribution: "reaction", mode: "respond" };
  }
}
