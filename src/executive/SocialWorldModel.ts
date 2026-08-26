/**
 * SocialWorldModel — AURA's internal understanding of how the human world
 * operates. One immutable knowledge layer. It answers ONE question:
 *
 *   "What human forces are probably influencing this conversation?"
 *
 * It never decides. It never generates prompts. It provides evidence —
 * always with confidence, reasoning, and alternative hypotheses. The
 * Executive consumes the evidence and decides; the LLM receives only the
 * strategy that results.
 *
 * The knowledge here is probabilistic, not diagnostic: culture and norms
 * are represented as probabilities, never deterministic truths.
 *
 * Anti-duplication contract (Phase 11 charter):
 *   - Perception owns observations.
 *   - ConversationUnderstanding owns conversational interpretation.
 *   - SocialWorldModel owns SOCIAL interpretation — it CONSUMES the
 *     understanding (literal/move/goal/implicit/social), never re-detects
 *     conversation phenomena (no sarcasm detection, no repair detection…).
 *   - Executive owns decisions.
 */

import type { ConversationContext } from "./ConversationContext";
import type { ConversationUnderstanding } from "./ConversationUnderstanding";
import { determineRelationshipStage } from "./RegisterState";
import type { RelationshipStage } from "./RegisterState";

export type SocialDomain =
  | "humanNeeds"
  | "socialPressures"
  | "relationshipDynamics"
  | "lifeContext"
  | "communicationNorms"
  | "motivation"
  | "constraints"
  | "risks"
  | "growthOpportunities";

export interface SocialInfluence {
  /** Stable influence id, e.g. "imposter-syndrome", "generational-conflict". */
  name: string;
  domain: SocialDomain;
  confidence: number;
  reasoning: ReadonlyArray<string>;
  alternatives: ReadonlyArray<string>;
}

export interface SocialUnderstanding {
  readonly humanNeeds: ReadonlyArray<SocialInfluence>;
  readonly socialPressures: ReadonlyArray<SocialInfluence>;
  readonly relationshipDynamics: ReadonlyArray<SocialInfluence>;
  readonly lifeContext: ReadonlyArray<SocialInfluence>;
  readonly communicationNorms: ReadonlyArray<SocialInfluence>;
  readonly motivation: ReadonlyArray<SocialInfluence>;
  readonly constraints: ReadonlyArray<SocialInfluence>;
  readonly risks: ReadonlyArray<SocialInfluence>;
  readonly growthOpportunities: ReadonlyArray<SocialInfluence>;
  readonly confidence: Readonly<{ value: number; reasoning: ReadonlyArray<string> }>;
  readonly reasoning: ReadonlyArray<string>;
  readonly raw: Readonly<{ text: string; clean: string }>;
}

// ─── Detector vocabulary (the only social interpretation primitives) ──

interface SocialDetector {
  name: string;
  domain: SocialDomain;
  phrases: ReadonlyArray<string>;
  base: number; // 0.55–0.85, phrase specificity
  reason: string;
}

const DETECTORS: ReadonlyArray<SocialDetector> = [
  // ── Human needs: what this person probably needs right now ─────────
  {
    name: "need-belonging",
    domain: "humanNeeds",
    base: 0.75,
    phrases: ["nobody likes me", "don t fit in", "left me out", "excluded", "no one wants me"],
    reason: "exclusion framing points at the need to belong",
  },
  {
    name: "need-competence",
    domain: "humanNeeds",
    base: 0.7,
    phrases: ["can t do anything right", "always mess up", "i m not capable", "i always fail"],
    reason: "self-doubt about capability flags the need for competence",
  },
  {
    name: "need-autonomy",
    domain: "humanNeeds",
    base: 0.72,
    phrases: [
      "won t let me decide",
      "can t make my own choices",
      "always controlling",
      "they decide everything for me",
    ],
    reason: "control framing flags the need for autonomy",
  },
  {
    name: "need-recognition",
    domain: "humanNeeds",
    base: 0.72,
    phrases: ["nobody notices", "no one appreciates", "goes unnoticed", "no one sees what i do"],
    reason: "invisibility framing flags the need for recognition",
  },
  {
    name: "need-purpose",
    domain: "humanNeeds",
    base: 0.7,
    phrases: [
      "what s the point",
      "my life has no direction",
      "i feel pointless",
      "no meaning anymore",
    ],
    reason: "meaning-questioning flags the need for purpose",
  },
  {
    name: "need-security",
    domain: "humanNeeds",
    base: 0.72,
    phrases: [
      "can t pay",
      "scared about money",
      "afraid of the future",
      "i m not safe",
      "darr lag raha",
    ],
    reason: "safety/financial fear flags the need for security",
  },
  {
    name: "need-connection",
    domain: "humanNeeds",
    base: 0.75,
    phrases: [
      "i feel so alone",
      "no one to talk to",
      "i m all by myself",
      "i miss my friends",
      "means a lot",
    ],
    reason: "aloneness framing flags the need for connection",
  },
  {
    name: "need-achievement",
    domain: "humanNeeds",
    base: 0.72,
    phrases: [
      "i finally did it",
      "i achieved my goal",
      "i reached my goal",
      "i made it happen",
      "promotion mil gayi",
      "mil gayi",
    ],
    reason: "goal-completion framing flags the need for achievement",
  },
  {
    name: "need-rest",
    domain: "humanNeeds",
    base: 0.72,
    phrases: ["i m so tired", "need a break", "i can t keep going", "running on empty"],
    reason: "exhaustion framing flags the need for rest",
  },
  {
    name: "need-growth",
    domain: "humanNeeds",
    base: 0.68,
    phrases: ["i want to get better", "i want to learn", "grow as a person", "i want to improve"],
    reason: "self-improvement framing flags the need for growth",
  },
  {
    name: "need-identity",
    domain: "humanNeeds",
    base: 0.72,
    phrases: [
      "don t know who i am",
      "who am i",
      "trying to find myself",
      "lost my identity",
      "kuch change ho gaya",
    ],
    reason: "self-questioning flags the need for identity",
  },

  // ── Social pressures: the world pushing on them ────────────────────
  {
    name: "family-expectations",
    domain: "socialPressures",
    base: 0.75,
    phrases: [
      "my parents expect",
      "my family wants me to",
      "my parents don t understand",
      "relatives keep asking",
      "my family is pressuring",
      "aur mehnat karo",
    ],
    reason: "family-voice framing indicates family expectations are live",
  },
  {
    name: "social-comparison",
    domain: "socialPressures",
    base: 0.7,
    phrases: [
      "everyone else is",
      "my friends are all",
      "compared to others",
      "other people my age",
    ],
    reason: "comparison framing indicates social comparison pressure",
  },
  {
    name: "career-pressure",
    domain: "socialPressures",
    base: 0.72,
    phrases: [
      "my job is killing me",
      "my career is stuck",
      "pressure at work",
      "i have to perform",
      "work is overwhelming",
    ],
    reason: "work-pressure framing indicates career pressure",
  },
  {
    name: "financial-pressure",
    domain: "socialPressures",
    base: 0.75,
    phrases: [
      "money is tight",
      "i can t afford",
      "i m in debt",
      "bills are piling up",
      "struggling financially",
    ],
    reason: "money-framing indicates financial pressure",
  },
  {
    name: "reputation-pressure",
    domain: "socialPressures",
    base: 0.7,
    phrases: [
      "what will people think",
      "i can t show weakness",
      "they d judge me",
      "what would everyone say",
    ],
    reason: "audience-framing indicates reputation pressure",
  },
  {
    name: "peer-pressure",
    domain: "socialPressures",
    base: 0.68,
    phrases: ["my friends keep telling me", "everyone is doing it", "my friends want me to"],
    reason: "friends-voice framing indicates peer pressure",
  },
  {
    name: "marriage-pressure",
    domain: "socialPressures",
    base: 0.75,
    phrases: [
      "when will you get married",
      "everyone keeps asking about marriage",
      "my relatives want me married",
      "matchmaking pressure",
    ],
    reason: "marriage-deadline framing indicates marriage pressure",
  },
  {
    name: "cultural-norms",
    domain: "socialPressures",
    base: 0.7,
    phrases: [
      "in my culture",
      "back home they",
      "our tradition says",
      "that s how we do it at home",
    ],
    reason: "tradition-framing indicates cultural-norm constraints",
  },

  // ── Relationship dynamics: how the human web is moving ─────────────
  {
    name: "generational-conflict",
    domain: "relationshipDynamics",
    base: 0.75,
    phrases: [
      "my parents don t understand me",
      "they grew up in a different time",
      "the older generation doesn t get it",
      "my parents and i clash",
    ],
    reason: "parents-vs-self framing indicates generational conflict",
  },
  {
    name: "trust-building",
    domain: "relationshipDynamics",
    base: 0.7,
    phrases: [
      "it s hard for me to open up",
      "i m starting to trust",
      "i m learning to trust",
      "i don t open up easily",
    ],
    reason: "disclosure-framing indicates trust is being built",
  },
  {
    name: "trust-break",
    domain: "relationshipDynamics",
    base: 0.78,
    phrases: [
      "she lied to me",
      "he broke his promise",
      "i was betrayed",
      "i can t trust them anymore",
      "they stabbed me in the back",
    ],
    reason: "betrayal framing indicates broken trust",
  },
  {
    name: "conflict-escalation",
    domain: "relationshipDynamics",
    base: 0.72,
    phrases: [
      "we keep fighting",
      "every conversation turns into a fight",
      "we argue about everything",
      "it always ends in a fight",
    ],
    reason: "repeated-conflict framing indicates escalation risk",
  },
  {
    name: "reconciliation",
    domain: "relationshipDynamics",
    base: 0.72,
    phrases: [
      "we made up",
      "i want to fix things",
      "i want to patch things up",
      "we re talking again",
    ],
    reason: "repair-framing indicates reconciliation in progress",
  },
  {
    name: "attachment-loss",
    domain: "relationshipDynamics",
    base: 0.75,
    phrases: [
      "we broke up",
      "she left me",
      "he left me",
      "i lost them",
      "she passed away",
      "he passed away",
      "my partner left",
    ],
    reason: "loss framing indicates an attachment wound",
  },
  {
    name: "boundary-setting",
    domain: "relationshipDynamics",
    base: 0.7,
    phrases: [
      "i had to set boundaries",
      "i said no to them",
      "i distanced myself",
      "i stopped picking up",
    ],
    reason: "limit-framing indicates boundary work",
  },
  {
    name: "distance-widening",
    domain: "relationshipDynamics",
    base: 0.7,
    phrases: [
      "we ve grown apart",
      "we don t talk anymore",
      "we drifted apart",
      "i don t know them anymore",
    ],
    reason: "drift framing indicates widening distance",
  },
  {
    name: "romance-development",
    domain: "relationshipDynamics",
    base: 0.72,
    phrases: ["we just started dating", "i met someone", "she asked me out", "i have a crush"],
    reason: "new-relationship framing indicates romance development",
  },

  // ── Life context: what stage of life they are moving through ───────
  {
    name: "career-transition",
    domain: "lifeContext",
    base: 0.72,
    phrases: [
      "i got a promotion",
      "i got the promotion",
      "promotion mil gayi",
      "i m changing jobs",
      "i m thinking of quitting",
      "i got fired",
      "i was laid off",
      "i m starting a new job",
    ],
    reason: "job-change framing indicates a career transition",
  },
  {
    name: "education-transition",
    domain: "lifeContext",
    base: 0.72,
    phrases: [
      "my exams are coming",
      "i m starting college",
      "final year is stressful",
      "i have board exams",
      "i m applying to university",
    ],
    reason: "education framing indicates a school/life transition",
  },
  {
    name: "parenthood",
    domain: "lifeContext",
    base: 0.75,
    phrases: [
      "i just had a baby",
      "my kid is",
      "parenting is hard",
      "i m a new parent",
      "my child is",
    ],
    reason: "child-framing indicates the parenthood life stage",
  },
  {
    name: "aging",
    domain: "lifeContext",
    base: 0.7,
    phrases: [
      "i m getting old",
      "my parents are aging",
      "i feel old",
      "my health is failing with age",
    ],
    reason: "age framing indicates the aging life stage",
  },
  {
    name: "marriage-life-stage",
    domain: "lifeContext",
    base: 0.72,
    phrases: ["we just got married", "my wedding is", "i m engaged", "i m planning my wedding"],
    reason: "wedding framing indicates the marriage life stage",
  },
  {
    name: "identity-transition",
    domain: "lifeContext",
    base: 0.7,
    phrases: [
      "i ve changed a lot",
      "i m becoming a different person",
      "i m not the same person",
      "i m reinventing myself",
    ],
    reason: "self-change framing indicates an identity transition",
  },
  {
    name: "relocation",
    domain: "lifeContext",
    base: 0.72,
    phrases: ["i moved to a new city", "i m moving away", "i relocated", "i m shifting to"],
    reason: "place-change framing indicates relocation",
  },
  {
    name: "retirement",
    domain: "lifeContext",
    base: 0.75,
    phrases: ["i m retiring", "after retirement", "my last day of work", "i m done with work life"],
    reason: "work-end framing indicates the retirement transition",
  },
  {
    name: "grief-life-stage",
    domain: "lifeContext",
    base: 0.72,
    phrases: [
      "since he passed",
      "after she died",
      "it s been a year since",
      "i lost my father",
      "i lost my mother",
    ],
    reason: "bereavement framing indicates grief is part of this life stage",
  },

  // ── Communication norms: how this person talks about things ────────
  {
    name: "indirect-request",
    domain: "communicationNorms",
    base: 0.7,
    phrases: ["it s really hot", "i m hungry", "i m thirsty", "it s too bright", "it s so noisy"],
    reason: "courtesy framing carries an unspoken request — the person rarely asks directly",
  },
  {
    name: "saving-face",
    domain: "communicationNorms",
    base: 0.68,
    phrases: [
      "i d love to but",
      "i wish i could but",
      "that sounds great but",
      "i d like to help but",
    ],
    reason: "hedged refusal preserves face rather than saying no plainly",
  },
  {
    name: "white-lie",
    domain: "communicationNorms",
    base: 0.65,
    phrases: ["i m fine", "i m okay", "nothing s wrong", "i m alright"],
    reason: "stock reassurance often masks true state — a social script, not a report",
  },
  {
    name: "conflict-avoidance",
    domain: "communicationNorms",
    base: 0.7,
    phrases: [
      "i don t want to start anything",
      "let s not talk about it",
      "i d rather not discuss",
      "let s drop it",
    ],
    reason: "deflection framing indicates conflict avoidance",
  },
  {
    name: "humor-as-relief",
    domain: "communicationNorms",
    base: 0.62,
    phrases: ["haha", "lol", "joking", "kidding"],
    reason: "levity under pressure is often a pressure valve",
  },
  {
    name: "storytelling-mode",
    domain: "communicationNorms",
    base: 0.7,
    phrases: [
      "so then i",
      "and suddenly",
      "let me tell you what happened",
      "you won t believe what",
    ],
    reason: "narrative framing indicates storytelling mode",
  },
  {
    name: "silence-communication",
    domain: "communicationNorms",
    base: 0.6,
    phrases: [],
    reason: "silence itself can be the message — the floor is being held or avoided",
  },
  {
    name: "repair-ritual",
    domain: "communicationNorms",
    base: 0.62,
    phrases: ["that s not what i meant", "let me rephrase", "i didn t mean it that way"],
    reason: "repair phrasing follows the human ritual of re-anchoring meaning",
  },
  {
    name: "ritual-greeting",
    domain: "communicationNorms",
    base: 0.65,
    phrases: ["hello", "hey", "namaste", "good morning", "how are you"],
    reason: "greetings are social rituals — contact before content",
  },

  // ── Motivation: the engine behind their behavior ───────────────────
  {
    name: "procrastination",
    domain: "motivation",
    base: 0.72,
    phrases: ["i keep putting it off", "i ll do it tomorrow", "i can t start", "i keep delaying"],
    reason: "deferral framing indicates procrastination — often fear, not laziness",
  },
  {
    name: "avoidance",
    domain: "motivation",
    base: 0.72,
    phrases: [
      "i ve been avoiding",
      "i don t want to face it",
      "i keep dodging it",
      "i can t look at it",
    ],
    reason: "avoidance framing indicates a difficult thing is being circled",
  },
  {
    name: "self-defense",
    domain: "motivation",
    base: 0.7,
    phrases: ["it s not my fault", "i did everything right", "i was trying to", "no one told me"],
    reason: "blame-externalizing framing indicates self-defense is active",
  },
  {
    name: "apology-motive",
    domain: "motivation",
    base: 0.72,
    phrases: [
      "i need to apologize",
      "i should say sorry",
      "i owe them an apology",
      "i feel bad about what i did",
    ],
    reason: "amends framing indicates an apology is being contemplated",
  },
  {
    name: "status-seeking",
    domain: "motivation",
    base: 0.68,
    phrases: [
      "i want to be respected",
      "i want to be someone",
      "i want people to look up to me",
      "i want to matter",
    ],
    reason: "standing-framing indicates status motivation",
  },
  {
    name: "sacrifice-motive",
    domain: "motivation",
    base: 0.7,
    phrases: [
      "i gave up so much",
      "i sacrificed my dreams",
      "i did it for them",
      "i put my life on hold",
    ],
    reason: "self-giving framing indicates sacrifice is a core motive",
  },
  {
    name: "career-change-motive",
    domain: "motivation",
    base: 0.7,
    phrases: [
      "i hate my job",
      "i want to do something else",
      "this isn t what i want to do",
      "i want out of this career",
    ],
    reason: "mismatch framing indicates a career-change impulse",
  },
  {
    name: "guilt-driven",
    domain: "motivation",
    base: 0.72,
    phrases: [
      "i feel guilty",
      "i feel terrible about",
      "it weighs on me",
      "i can t forgive myself",
    ],
    reason: "guilt is future-facing — it pushes toward repair, unlike regret",
  },

  // ── Constraints: the real-world limits on their choices ────────────
  {
    name: "time-pressure",
    domain: "constraints",
    base: 0.72,
    phrases: [
      "i don t have time",
      "i m so busy",
      "i have deadlines",
      "i m swamped",
      "no time for anything",
    ],
    reason: "time-framing indicates the constraint of time",
  },
  {
    name: "responsibility-load",
    domain: "constraints",
    base: 0.7,
    phrases: [
      "i have to take care of",
      "i m responsible for",
      "i can t leave my family",
      "i have dependents",
    ],
    reason: "duty-framing indicates the constraint of responsibility",
  },
  {
    name: "health-limits",
    domain: "constraints",
    base: 0.72,
    phrases: ["my health is bad", "i m sick", "my body can t", "the doctor said", "i have chronic"],
    reason: "health framing indicates a bodily constraint",
  },
  {
    name: "geography-separation",
    domain: "constraints",
    base: 0.7,
    phrases: ["they re so far away", "i miss home", "long distance", "we live in different cities"],
    reason: "distance framing indicates the constraint of geography",
  },
  {
    name: "technology-gap",
    domain: "constraints",
    base: 0.65,
    phrases: [
      "i don t understand these apps",
      "everything is online now",
      "i can t use the computer",
      "these new gadgets",
    ],
    reason: "technology framing indicates a participation gap",
  },

  // ── Risks: what could be going wrong underneath ────────────────────
  {
    name: "imposter-syndrome",
    domain: "risks",
    base: 0.81,
    phrases: [
      "i don t deserve this",
      "i don t deserve",
      "i don t think i deserve",
      "they ll find out i m a fraud",
      "i got lucky",
      "i m not good enough",
      "i m faking it",
    ],
    reason: "deservingness doubt indicates imposter syndrome — achievement read as luck",
  },
  {
    name: "burnout",
    domain: "risks",
    base: 0.78,
    phrases: [
      "i m exhausted",
      "i m so exhausted",
      "i can t do this anymore",
      "i m burned out",
      "i have nothing left",
    ],
    reason: "depletion framing indicates burnout risk",
  },
  {
    name: "loneliness",
    domain: "risks",
    base: 0.78,
    phrases: [
      "i feel lonely",
      "i feel so lonely",
      "i have no friends",
      "i m always alone",
      "nobody calls me",
    ],
    reason: "isolation framing indicates loneliness risk",
  },
  {
    name: "identity-crisis",
    domain: "risks",
    base: 0.75,
    phrases: [
      "i don t know who i am anymore",
      "i ve lost myself",
      "i m a stranger to myself",
      "who have i become",
    ],
    reason: "self-estrangement framing indicates an identity crisis",
  },
  {
    name: "fear-of-rejection",
    domain: "risks",
    base: 0.72,
    phrases: [
      "i m scared to ask",
      "what if they say no",
      "i m afraid of being rejected",
      "i can t face another no",
    ],
    reason: "refusal-anticipation framing indicates fear of rejection",
  },
  {
    name: "perfectionism",
    domain: "risks",
    base: 0.72,
    phrases: [
      "it has to be perfect",
      "i can t make mistakes",
      "i m never satisfied",
      "not good enough unless it s flawless",
    ],
    reason: "zero-defect framing indicates perfectionism pressure",
  },
  {
    name: "financial-stress",
    domain: "risks",
    base: 0.78,
    phrases: [
      "i m drowning in bills",
      "i can t make ends meet",
      "i m behind on rent",
      "i don t know how i ll pay",
    ],
    reason: "survival-money framing indicates acute financial stress",
  },
  {
    name: "relationship-breakdown",
    domain: "risks",
    base: 0.75,
    phrases: [
      "we re falling apart",
      "our marriage is struggling",
      "we might separate",
      "it s falling to pieces",
    ],
    reason: "collapse framing indicates relationship-breakdown risk",
  },
  {
    name: "grief-lingering",
    domain: "risks",
    base: 0.72,
    phrases: [
      "i still can t get over",
      "it still hurts",
      "i think about them every day",
      "i can t move on",
    ],
    reason: "stuck-grief framing indicates grief is still unresolved",
  },

  // ── Growth opportunities: where change could happen ────────────────
  {
    name: "reflection-moment",
    domain: "growthOpportunities",
    base: 0.7,
    phrases: [
      "i ve been thinking about my life",
      "lately i ve been reflecting",
      "looking back at everything",
      "i ve been reviewing",
    ],
    reason: "review framing indicates a reflective opening",
  },
  {
    name: "apology-opening",
    domain: "growthOpportunities",
    base: 0.72,
    phrases: [
      "i want to say sorry",
      "i owe them an apology",
      "i should apologize",
      "i need to make it right",
    ],
    reason: "amends framing is a live opening for reconciliation",
  },
  {
    name: "trust-rebuilding",
    domain: "growthOpportunities",
    base: 0.72,
    phrases: [
      "i m trying to forgive",
      "i want to trust again",
      "i m giving them another chance",
      "i m working on trust",
    ],
    reason: "second-chance framing indicates trust-rebuilding work",
  },
  {
    name: "boundary-opportunity",
    domain: "growthOpportunities",
    base: 0.7,
    phrases: [
      "i need to learn to say no",
      "i should set boundaries",
      "i m learning to say no",
      "i need to protect my time",
      "mood nahi",
    ],
    reason: "limit-learning framing is a boundary-growth opening",
  },
  {
    name: "courage-moment",
    domain: "growthOpportunities",
    base: 0.72,
    phrases: [
      "i m scared but i ll",
      "i m going to try anyway",
      "i m taking the leap",
      "i ll do it even though i m afraid",
    ],
    reason: "fear-plus-action framing is a courage moment",
  },
  {
    name: "recovery-transition",
    domain: "growthOpportunities",
    base: 0.72,
    phrases: ["i m getting better", "i m healing", "i took the first step", "i m coming out of it"],
    reason: "healing framing indicates recovery in motion",
  },
];

// ─── CUE-signal hooks: SWM consumes canonical understanding, never re-detects ──

interface CueHook {
  name: string;
  domain: SocialDomain;
  base: number;
  match: (ctx: ConversationContext, u: ConversationUnderstanding) => boolean;
  reason: string;
}

const CUE_HOOKS: ReadonlyArray<CueHook> = [
  {
    name: "indirect-request",
    domain: "communicationNorms",
    base: 0.7,
    match: (_c, u) => u.implicit?.label === "hidden-request",
    reason: "understanding layer flagged an implicit request behind courtesy phrasing",
  },
  {
    name: "white-lie",
    domain: "communicationNorms",
    base: 0.65,
    match: (_c, u) => u.implicit?.label === "not-fine",
    reason: "understanding layer flagged a contradicted stock reassurance",
  },
  {
    name: "validation-seeking",
    domain: "motivation",
    base: 0.7,
    match: (_c, u) => u.speakerGoal === "seek-validation",
    reason: "understanding layer read the goal as validation-seeking",
  },
  {
    name: "humor-as-relief",
    domain: "communicationNorms",
    base: 0.62,
    match: (ctx, u) =>
      u.social.some((s) => s.name === "sarcasm" || s.name === "playfulness") &&
      (ctx.emotion.vulnerability > 0.3 || ctx.emotion.frustration > 0.5),
    reason: "levity sits on top of vulnerability — a pressure valve, not lightness",
  },
  {
    name: "ritual-greeting",
    domain: "communicationNorms",
    base: 0.65,
    match: (_c, u) => u.literal === "greeting",
    reason: "greeting is a social ritual — contact before content",
  },
  {
    name: "storytelling-mode",
    domain: "communicationNorms",
    base: 0.7,
    match: (_c, u) => u.literal === "story" || u.speakerGoal === "tell-story",
    reason: "narrative mode confirmed by the understanding layer",
  },
  {
    name: "silence-communication",
    domain: "communicationNorms",
    base: 0.6,
    match: (_c, u) => u.literal === "silence",
    reason: "silence is itself a message the understanding layer surfaced",
  },
  {
    name: "repair-ritual",
    domain: "communicationNorms",
    base: 0.62,
    match: (_c, u) => u.move === "Repair",
    reason: "conversational repair is a human ritual the understanding layer saw",
  },
  {
    name: "grief-life-stage",
    domain: "lifeContext",
    base: 0.6,
    match: (_c, u) =>
      (u.speakerGoal === "seek-comfort" || u.expected === "empathy") &&
      (u.literal === "story" || u.literal === "statement") &&
      (u.move === "Comfort" || u.move === "Reflect"),
    reason: "empathy-seeking about a life event often means a loss is being carried",
  },
  {
    name: "trust-building",
    domain: "relationshipDynamics",
    base: 0.62,
    match: (ctx, u) =>
      ctx.memory.hasPersonalHistory === false &&
      (u.speakerGoal === "tell-story" || u.literal === "story" || ctx.emotion.vulnerability > 0.5),
    reason: "early disclosure in a new relationship is trust being built",
  },
];

// ─── Emotional-knowledge rules: WHY emotions appear ──────────────────
// Emotion detection stays in perception; the SWM explains the why.

const EMOTION_RULES: ReadonlyArray<SocialDetector> = [
  {
    name: "reputation-pressure",
    domain: "socialPressures",
    base: 0.68,
    phrases: ["i m ashamed", "so embarrassing", "i can t face them", "i m so embarrassed"],
    reason: "shame appears when the public self is threatened — face is on the line",
  },
  {
    name: "social-comparison",
    domain: "socialPressures",
    base: 0.68,
    phrases: ["i m jealous", "i envy them", "why do they get", "it s not fair they have"],
    reason: "jealousy surfaces when comparison threatens identity or belonging",
  },
  {
    name: "need-connection",
    domain: "humanNeeds",
    base: 0.65,
    phrases: ["i miss those days", "reminds me of", "back when we", "the good old days"],
    reason: "nostalgia is usually a reach for lost connection, not lost time",
  },
  {
    name: "apology-motive",
    domain: "motivation",
    base: 0.68,
    phrases: ["i feel bad about it", "i should have been there", "i wish i had done more"],
    reason: "guilt is future-facing — it pushes toward repair",
  },
  {
    name: "self-defense",
    domain: "motivation",
    base: 0.65,
    phrases: ["i had no choice", "everyone was against me", "they made me do it"],
    reason: "defensiveness rises when identity feels attacked",
  },
];

// ─── Confidence modifiers ─────────────────────────────────────────────

function adjust(base: number, stt: number, uConf: number, relationship: RelationshipStage): number {
  let c = base;
  if (stt < 0.6) c *= 0.9; // uncertain hearing → uncertain social read
  if (uConf >= 0.7) c += 0.05; // a confident conversational read supports the social read
  if (relationship === "INTIMATE" || relationship === "COMFORTABLE") c += 0.02; // context supports deeper reading
  return Math.max(0.35, Math.min(0.9, Math.round(c * 100) / 100));
}

// ─── The single builder ──────────────────────────────────────────────
// deriveSocialUnderstanding(ctx, u) is the ONLY place social meaning is inferred.

export function deriveSocialUnderstanding(
  ctx: ConversationContext,
  u: ConversationUnderstanding,
): SocialUnderstanding {
  const text = ctx.input.text.trim();
  const clean = u.raw.clean;
  const stt = u.context.sttConfidence;
  const relationship = determineRelationshipStage({
    sessionTurn: ctx.timing.turnCount,
    hasPersonalHistory: ctx.memory.hasPersonalHistory,
    trust: ctx.emotion.trust,
  });

  const scored = new Map<string, { domain: SocialDomain; confidence: number; reasons: string[] }>();
  const add = (name: string, domain: SocialDomain, confidence: number, reason: string) => {
    const existing = scored.get(name);
    if (existing) {
      if (confidence > existing.confidence) existing.confidence = confidence;
      existing.reasons.push(reason);
      if (existing.reasons.length > 3) existing.reasons = existing.reasons.slice(-3);
      return;
    }
    scored.set(name, { domain, confidence, reasons: [reason] });
  };

  // 1. Phrase detectors — probabilistic, never deterministic truths.
  for (const d of DETECTORS) {
    const hits = d.phrases.filter((p) => p !== "" && clean.includes(p));
    if (hits.length === 0) continue;
    const specificity = Math.min(1, 0.55 + hits.length * 0.15);
    const confidence = adjust(d.base * specificity, stt, u.confidence.value, relationship);
    add(d.name, d.domain, confidence, `${d.reason} (evidence: "${hits[0]}")`);
  }

  // 2. Emotion-knowledge rules (why, not whether).
  for (const d of EMOTION_RULES) {
    const hits = d.phrases.filter((p) => clean.includes(p));
    if (hits.length === 0) continue;
    const confidence = adjust(d.base, stt, u.confidence.value, relationship);
    add(d.name, d.domain, confidence, `${d.reason} (evidence: "${hits[0]}")`);
  }

  // 3. CUE-signal hooks — consume the canonical understanding, never re-detect.
  for (const h of CUE_HOOKS) {
    if (h.reason && h.match(ctx, u)) {
      const confidence = adjust(h.base, stt, u.confidence.value, relationship);
      add(h.name, h.domain, confidence, h.reason);
    }
  }

  // 4. Human-need inference from conversation state (layered, not word-matched).
  if (u.state === "reflection" && (u.move === "Reflect" || u.move === "Comfort")) {
    const confidence = adjust(0.6, stt, u.confidence.value, relationship);
    add(
      "need-identity",
      "humanNeeds",
      confidence,
      "reflective sharing usually orbits identity work",
    );
  }
  if (
    (u.expected === "empathy" ||
      (ctx.emotion.vulnerability > 0.55 && (u.move === "Comfort" || u.move === "Reflect"))) &&
    (u.move === "Comfort" || u.move === "Reflect")
  ) {
    const confidence = adjust(0.6, stt, u.confidence.value, relationship);
    add("need-connection", "humanNeeds", confidence, "empathy-seeking is connection-seeking");
  }
  if (u.speakerGoal === "complain") {
    const confidence = adjust(0.55, stt, u.confidence.value, relationship);
    add(
      "need-recognition",
      "humanNeeds",
      confidence,
      "complaints are often unrecognized work surfacing",
    );
  }

  // 5. Constraints & risks from life-stage interaction (single evidence each).
  if (relationship === "INTIMATE" || relationship === "COMFORTABLE") {
    const trustBreak = scored.get("trust-break");
    const conflictEsc = scored.get("conflict-escalation");
    if (trustBreak || conflictEsc) {
      const confidence = adjust(0.6, stt, u.confidence.value, relationship);
      add(
        "relationship-breakdown",
        "risks",
        confidence,
        "trust damage inside a close relationship is a breakdown risk",
      );
    }
  }

  // Per-domain cap: keep the top 3, tie-break by confidence.
  const byDomain = (domain: SocialDomain) =>
    [...scored.entries()]
      .filter(([, v]) => v.domain === domain)
      .sort((a, b) => b[1].confidence - a[1].confidence)
      .slice(0, 3);

  const toInfluences = (domain: SocialDomain): SocialInfluence[] =>
    byDomain(domain).map(([name, v]) => {
      const alternatives = [...scored.entries()]
        .filter(([n, o]) => o.domain === domain && n !== name)
        .sort((a, b) => b[1].confidence - a[1].confidence)
        .slice(0, 2)
        .map(([n]) => n);
      return Object.freeze({
        name,
        domain,
        confidence: v.confidence,
        reasoning: Object.freeze(v.reasons),
        alternatives: Object.freeze(alternatives),
      });
    });

  const domains: SocialDomain[] = [
    "humanNeeds",
    "socialPressures",
    "relationshipDynamics",
    "lifeContext",
    "communicationNorms",
    "motivation",
    "constraints",
    "risks",
    "growthOpportunities",
  ];
  const out = {} as Record<SocialDomain, SocialInfluence[]>;
  for (const d of domains) out[d] = toInfluences(d);

  const all = domains.flatMap((d) => out[d]);
  const top = [...all].sort((a, b) => b.confidence - a.confidence)[0];
  const overallValue = top ? top.confidence : 0.35;
  const overallReasoning = top
    ? [
        `top influence: ${top.name} (${top.confidence.toFixed(2)})`,
        `domain: ${top.domain}`,
        ...top.reasoning.slice(0, 2),
      ]
    : ["no social influence above threshold — surface conversation"];
  const flatReasons = all.map((i) => `${i.name}(${i.confidence.toFixed(2)})`);

  return Object.freeze({
    humanNeeds: Object.freeze(out.humanNeeds),
    socialPressures: Object.freeze(out.socialPressures),
    relationshipDynamics: Object.freeze(out.relationshipDynamics),
    lifeContext: Object.freeze(out.lifeContext),
    communicationNorms: Object.freeze(out.communicationNorms),
    motivation: Object.freeze(out.motivation),
    constraints: Object.freeze(out.constraints),
    risks: Object.freeze(out.risks),
    growthOpportunities: Object.freeze(out.growthOpportunities),
    confidence: Object.freeze({
      value: overallValue,
      reasoning: Object.freeze(overallReasoning),
    }),
    reasoning: Object.freeze(flatReasons),
    raw: Object.freeze({ text, clean }),
  });
}

/** Flatten every influence across the 9 domains, highest confidence first. */
export function allInfluences(s: SocialUnderstanding): SocialInfluence[] {
  return (
    [
      "humanNeeds",
      "socialPressures",
      "relationshipDynamics",
      "lifeContext",
      "communicationNorms",
      "motivation",
      "constraints",
      "risks",
      "growthOpportunities",
    ] as SocialDomain[]
  )
    .flatMap((d) => s[d] as ReadonlyArray<SocialInfluence>)
    .sort((a, b) => b.confidence - a.confidence);
}
