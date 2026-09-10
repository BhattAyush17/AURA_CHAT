import type { PersonObservation } from "./SocialDecision";

const STORAGE_KEY_PREFIX = "aura_person_model_";
const DECAY_DAYS = 7;
const HALF_LIFE_MS = DECAY_DAYS * 24 * 60 * 60 * 1000;
const MAX_EVIDENCE = 20;
const MAX_SAMPLES = 3;

const OBSERVATION_MAP: Record<string, { category: string; label: string; keywords: string[] }[]> = {
  current_interests: [
    {
      category: "current_interests",
      label: "topic interest",
      keywords: ["love", "enjoy", "like", "passionate", "interested in"],
    },
  ],
  recurring_topics: [
    {
      category: "recurring_topics",
      label: "work topic",
      keywords: ["work", "office", "job", "career", "boss", "colleague", "project"],
    },
    {
      category: "recurring_topics",
      label: "personal topic",
      keywords: ["family", "friend", "relationship", "mom", "dad", "brother", "sister"],
    },
    {
      category: "recurring_topics",
      label: "health topic",
      keywords: ["health", "doctor", "sleep", "exercise", "therapy", "anxiety", "stress"],
    },
  ],
  communication_patterns: [
    { category: "communication_patterns", label: "brief communicator", keywords: [] },
    { category: "communication_patterns", label: "elaborate communicator", keywords: [] },
  ],
  humor_style: [
    { category: "humor_style", label: "playful", keywords: [] },
    { category: "humor_style", label: "sarcastic", keywords: [] },
  ],
  decision_style: [
    {
      category: "decision_style",
      label: "decisive",
      keywords: ["definitely", "i'm sure", "certainly", "absolutely", "no doubt"],
    },
    {
      category: "decision_style",
      label: "cautious",
      keywords: ["maybe", "i don't know", "not sure", "perhaps", "might", "possibly"],
    },
  ],
};

function observationId(category: string, label: string): string {
  return `${category}:${label}`;
}

export class PersonModel {
  private observations: Map<string, PersonObservation> = new Map();
  private userId: string = "";
  private turnCount = 0;

  setUserId(id: string): void {
    if (id !== this.userId) {
      this.userId = id;
      this.load();
    }
  }

  observeTurn(
    text: string,
    wordCount: number,
    isQuestion: boolean,
    backendEmotionalState?: string,
    backendPlayfulness?: number,
  ): void {
    this.turnCount++;
    const lower = text.toLowerCase();
    const now = Date.now();

    // Communication patterns
    const briefObsId = observationId("communication_patterns", "brief communicator");
    const elaborateObsId = observationId("communication_patterns", "elaborate communicator");
    if (wordCount <= 5 && !isQuestion) {
      this.observe(briefObsId, "communication_patterns", "brief communicator", text);
    } else if (wordCount >= 20) {
      this.observe(elaborateObsId, "communication_patterns", "elaborate communicator", text);
    }

    // Decisiveness markers
    const decisiveList = [
      "definitely",
      "i'm sure",
      "certainly",
      "absolutely",
      "no doubt",
      "for sure",
      "without question",
    ];
    const cautiousList = [
      "maybe",
      "i don't know",
      "not sure",
      "perhaps",
      "might",
      "possibly",
      "i guess",
      "probably",
    ];
    const decisiveMatch = decisiveList.some((k) => lower.includes(k));
    const cautiousMatch = cautiousList.some((k) => lower.includes(k));
    if (decisiveMatch) {
      this.observe(observationId("decision_style", "decisive"), "decision_style", "decisive", text);
    }
    if (cautiousMatch) {
      this.observe(observationId("decision_style", "cautious"), "decision_style", "cautious", text);
    }

    // Topic keywords
    for (const [, defs] of Object.entries(OBSERVATION_MAP)) {
      for (const def of defs) {
        if (def.keywords.length > 0 && def.keywords.some((k) => lower.includes(k))) {
          this.observe(observationId(def.category, def.label), def.category, def.label, text);
        }
      }
    }

    // Humor / playfulness
    const playfulness = backendPlayfulness ?? 0;
    if (playfulness > 0.6) {
      this.observe(observationId("humor_style", "playful"), "humor_style", "playful", text);
    }

    // Emotional intensity
    if (backendEmotionalState) {
      const intenseKeywords = ["frustration", "anger", "excitement", "distressed", "anxious"];
      const hasIntense = intenseKeywords.some((k) =>
        backendEmotionalState.toLowerCase().includes(k),
      );
      if (hasIntense) {
        this.observe(
          observationId("current_interests", "emotional intensity"),
          "current_interests",
          "emotional intensity",
          text,
        );
      }
    }

    this.save();
  }

  private observe(id: string, category: string, label: string, sample: string): void {
    const now = Date.now();
    const existing = this.observations.get(id);
    if (existing) {
      existing.evidence_count++;
      existing.confidence = this.computeConfidence(
        existing.evidence_count,
        now - existing.first_observed,
      );
      existing.last_observed = now;
      existing.significance = this.computeSignificance(
        existing.evidence_count,
        now - existing.first_observed,
      );
      if (!existing.samples.includes(sample)) {
        existing.samples.push(sample);
        if (existing.samples.length > MAX_SAMPLES) existing.samples.shift();
      }
    } else {
      this.observations.set(id, {
        id,
        label,
        category,
        evidence_count: 1,
        confidence: 0.3,
        last_observed: now,
        first_observed: now,
        significance: 0.3,
        samples: [sample],
      });
    }
  }

  private computeConfidence(evidenceCount: number, ageMs: number): number {
    const raw = Math.min(0.3 + evidenceCount * 0.12, 0.95);
    const decay = Math.exp((-ageMs * Math.LN2) / HALF_LIFE_MS);
    return Math.round(raw * decay * 100) / 100;
  }

  private computeSignificance(evidenceCount: number, ageMs: number): number {
    const recencyWeight = Math.exp((-ageMs * Math.LN2) / HALF_LIFE_MS);
    const freqWeight = Math.min(evidenceCount / 10, 1);
    return Math.min(recencyWeight * 0.4 + freqWeight * 0.6, 1);
  }

  getObservation(id: string): PersonObservation | undefined {
    return this.observations.get(id);
  }

  getAllObservations(): PersonObservation[] {
    this.applyDecay();
    return [...this.observations.values()].sort((a, b) => b.confidence - a.confidence);
  }

  getSignificantObservations(threshold = 0.3): PersonObservation[] {
    return this.getAllObservations().filter((o) => o.confidence >= threshold);
  }

  getCategory(category: string): PersonObservation[] {
    return this.getAllObservations().filter((o) => o.category === category);
  }

  getMostRecurringTopics(): string[] {
    return this.getCategory("recurring_topics")
      .filter((o) => o.confidence > 0.3 && o.evidence_count >= 2)
      .map((o) => o.label);
  }

  getCommunicationPattern(): string | null {
    const brief = this.getObservation(
      observationId("communication_patterns", "brief communicator"),
    );
    const elaborate = this.getObservation(
      observationId("communication_patterns", "elaborate communicator"),
    );
    if (!brief && !elaborate) return null;
    if (!elaborate) return "brief";
    if (!brief) return "elaborate";
    return brief.evidence_count > elaborate.evidence_count ? "brief" : "elaborate";
  }

  getDecisionStyle(): string | null {
    const decisive = this.getObservation(observationId("decision_style", "decisive"));
    const cautious = this.getObservation(observationId("decision_style", "cautious"));
    if (!decisive && !cautious) return null;
    if (!cautious) return "decisive";
    if (!decisive) return "cautious";
    return decisive.evidence_count > cautious.evidence_count ? "decisive" : "cautious";
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  applyDecay(): void {
    const now = Date.now();
    for (const [, obs] of this.observations) {
      const age = now - obs.last_observed;
      const newConf = this.computeConfidence(obs.evidence_count, age);
      obs.confidence = newConf;
      obs.significance = this.computeSignificance(obs.evidence_count, age);
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + this.userId);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.observations = new Map(Object.entries(parsed));
      this.turnCount = parsed._turnCount ?? 0;
      this.applyDecay();
    } catch {
      this.observations = new Map();
    }
  }

  private save(): void {
    try {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of this.observations) {
        obj[k] = v;
      }
      obj._turnCount = this.turnCount;
      localStorage.setItem(STORAGE_KEY_PREFIX + this.userId, JSON.stringify(obj));
    } catch {
      // localStorage quota or unavailable
    }
  }

  reset(): void {
    this.observations = new Map();
    this.turnCount = 0;
    try {
      localStorage.removeItem(STORAGE_KEY_PREFIX + this.userId);
    } catch {}
  }
}
