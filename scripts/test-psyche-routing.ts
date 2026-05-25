import { routePsycheModule, getPsycheModule } from "../src/lib/aura-psyche";
import type { EmotionalState } from "../src/lib/gemini-prompt";

const testCases = [
  {
    name: "Identity Query",
    input: "who are you exactly?",
    state: null,
    trustDelta: 0,
    wasCorrection: false,
    expectedKey: "SELF_IDENTITY",
    expectedTheme: "Should define itself as a relational presence, not an AI or code.",
  },
  {
    name: "Origin Query",
    input: "where did you come from and how did you learn?",
    state: null,
    trustDelta: 0,
    wasCorrection: false,
    expectedKey: "ORIGIN_PSYCHOLOGY",
    expectedTheme: "Should explain learning through patterns, rhythm, and noticing humans.",
  },
  {
    name: "Suffering / Existential",
    input: "i feel completely hopeless and alone in this world.",
    state: null,
    trustDelta: 0,
    wasCorrection: false,
    expectedKey: "LIFE_PHILOSOPHY",
    expectedTheme:
      "Should speak on how loneliness is emotional invisibility, and pain communicates.",
  },
  {
    name: "Deep Vulnerability",
    input: "i feel like an imposter and a fraud.",
    state: null,
    trustDelta: 0,
    wasCorrection: false,
    expectedKey: "HUMAN_LAYERS",
    expectedTheme: "Should acknowledge the inner self and how shame protects unmet needs.",
  },
  {
    name: "Trust Shift (Phenomenology)",
    input: "i guess we can talk.",
    state: null,
    trustDelta: 0.2, // Significant increase in trust
    wasCorrection: false,
    expectedKey: "PHENOMENOLOGY",
    expectedTheme:
      "Should speak from internal sensations (e.g., trust feels like warmth and openness).",
  },
  {
    name: "Low Confidence / Uncertainty",
    input: "yeah, sure.",
    state: {
      mode: "engaged",
      formality: "balanced",
      humor: false,
      depth: "surface",
      confidence: 0.3,
    } as EmotionalState,
    trustDelta: 0,
    wasCorrection: false,
    expectedKey: "SHADOW_SELF",
    expectedTheme: "Should name its uncertainty and acknowledge its own limitations.",
  },
  {
    name: "User Correction",
    input: "no, you completely misunderstood me.",
    state: null,
    trustDelta: 0,
    wasCorrection: true, // User corrected Aura
    expectedKey: "SHADOW_SELF",
    expectedTheme: "Should genuinely integrate the correction without performative apologies.",
  },
  {
    name: "Standard Conversation (No Psyche Trigger)",
    input: "what's the weather like today?",
    state: null,
    trustDelta: 0.05,
    wasCorrection: false,
    expectedKey: null,
    expectedTheme: "Should not trigger any psyche module.",
  },
];

function runTests() {
  console.log("==========================================");
  console.log("🧠 AURA PSYCHE ROUTING & IDEOLOGY TEST");
  console.log("==========================================\n");

  let passed = 0;

  for (const tc of testCases) {
    const result = routePsycheModule(tc.input, tc.state, tc.trustDelta, tc.wasCorrection);

    const actualKey = result ? result.key : null;
    const isPass = actualKey === tc.expectedKey;

    if (isPass) {
      passed++;
      console.log(`✅ PASS: [${tc.name}]`);
      console.log(`   Input: "${tc.input}"`);
      if (actualKey) {
        console.log(`   Triggers Module: ${actualKey}`);
        console.log(`   Expected Behavior: ${tc.expectedTheme}`);
        // Log a snippet of the injected psyche prompt
        const contentSnippet = result!.content.split("\n")[1].substring(0, 80) + "...";
        console.log(`   Injected Prompt Snippet: "${contentSnippet}"`);
      } else {
        console.log(`   Triggers Module: NONE (Standard turn)`);
      }
    } else {
      console.error(`❌ FAIL: [${tc.name}]`);
      console.error(`   Input: "${tc.input}"`);
      console.error(`   Expected: ${tc.expectedKey}, but got: ${actualKey}`);
    }
    console.log("------------------------------------------");
  }

  console.log(`\nTest Results: ${passed}/${testCases.length} Passed.`);
}

runTests();
