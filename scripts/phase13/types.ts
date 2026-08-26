export interface TurnBehavior {
  act?: string;
  tags?: string[];
  intensity?: number;
  playfulness?: number;
  vulnerability?: number;
  frustration?: number;
  trust?: number;
  energy?: number;
}

export interface TurnEmotion {
  dominant?: string;
  tension?: number;
  trust?: number;
  energy?: number;
  warmth?: number;
  engagement?: number;
  frustration?: number;
  vulnerability?: number;
  arc?: string;
}

export interface TurnExpected {
  move?: string[];
  goal?: string[];
  strategy: string[];
  initiative?: string[];
  register?: string[];
  language?: string[];
  relationship?: string;
  memoryPolicy?: "Required" | "Optional" | "Ignore";
  swm?: string[];
}

export interface DatasetTurn {
  text: string;
  behavior?: TurnBehavior | null;
  emo?: TurnEmotion;
  silenceMs?: number;
  interruption?: boolean;
  memory?: string[];
  expected: TurnExpected;
}

export interface Dataset {
  id: string;
  name: string;
  trust: number;
  hasPersonalHistory: boolean;
  languageMode: "hinglish" | "english";
  durationMinutes: number;
  turns: DatasetTurn[];
}

export const RELATIONSHIP_TARGETS: Record<string, string> = {
  "friendly-banter": "ACQUAINTING",
  "close-friends": "ACQUAINTING",
  siblings: "ACQUAINTING",
  "parent-child": "ACQUAINTING",
  romantic: "ACQUAINTING",
  workplace: "ACQUAINTING",
  interview: "NEW",
  stranger: "NEW",
  argument: "ACQUAINTING",
  comfort: "ACQUAINTING",
  apology: "ACQUAINTING",
  grief: "ACQUAINTING",
  celebration: "ACQUAINTING",
  "group-conversation": "ACQUAINTING",
  debate: "ACQUAINTING",
  negotiation: "ACQUAINTING",
  teaching: "ACQUAINTING",
  storytelling: "ACQUAINTING",
  flirting: "ACQUAINTING",
  "dark-humor": "ACQUAINTING",
  "adult-humor": "ACQUAINTING",
  sarcasm: "ACQUAINTING",
  roasting: "ACQUAINTING",
  "awkward-silence": "ACQUAINTING",
  misunderstanding: "ACQUAINTING",
  "conversation-repair": "ACQUAINTING",
  "topic-switching": "ACQUAINTING",
  "long-term-callback": "ACQUAINTING",
  "mixed-language": "ACQUAINTING",
  "emotional-breakdown": "ACQUAINTING",
  "confidence-testing": "ACQUAINTING",
  "social-pressure": "ACQUAINTING",
  "ethical-dilemma": "ACQUAINTING",
  "personal-failure": "ACQUAINTING",
  success: "ACQUAINTING",
};
