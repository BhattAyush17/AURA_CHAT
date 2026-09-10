import { getSocialCognitionEngine } from "../src/runtime/socialCognition/SocialCognitionEngine";
import type { SocialDecisionObject } from "../src/runtime/socialCognition/SocialDecision";

const engine = getSocialCognitionEngine();

const decision: SocialDecisionObject | null = engine.processTurn({
  text: "Sorry I ignored you, I'm just really stressed about work today.",
  userId: "test-user",
  wordCount: 11,
  isQuestion: false,
  userInitiated: true,
  backendVulnerability: 0.7,
  backendTension: 0.8,
  backendEnergy: 0.3,
  backendPlayfulness: 0.1,
  clarificationRequired: false,
  auraAskedQuestionThisTurn: false,
  isAuraInterrupted: false,
  silenceMs: 0,
  recentHistory: [],
});

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

if (!decision) {
  console.error(`${bold}FAIL${reset} — social cognition returned null on a substantive turn`);
  process.exit(1);
}

const block = engine.formatForPrompt(decision);
console.log(`${bold}[SOCIAL COGNITION SMOKE]${reset}`);
console.log(`${dim}decision.presence=`.padEnd(22) + dim + `${decision.presence}${reset}`);
console.log(`${dim}decision.format=`.padEnd(22) + dim + `${decision.format}${reset}`);
console.log(
  `${dim}decision.length=`.padEnd(22) + dim + `${(decision.length ?? "n/a").toString()}${reset}`,
);
console.log(`${dim}formatForPrompt chars=`.padEnd(22) + dim + `${block.length}${reset}`);
console.log("----prompt block----");
console.log(block.trim());
console.log("--------------------");
console.log(`${bold}PASS${reset} — decision non-null, block non-empty`);
process.exit(block.trim().length > 0 ? 0 : 2);
