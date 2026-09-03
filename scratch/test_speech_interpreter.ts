import { VoiceSpeechInterpreter } from "../src/core/voice-language/VoiceSpeechInterpreter";
import { VoiceSpeechProfile } from "../src/core/voice-language/VoiceLanguageTypes";

const interpreter = new VoiceSpeechInterpreter();

function test(
  name: string,
  raw: string,
  profile: VoiceSpeechProfile,
  context: string[],
  expected: string,
) {
  const result = interpreter.interpret(raw, profile, context);
  if (result === expected) {
    console.log(`✅ [PASS] ${name}`);
  } else {
    console.error(`❌ [FAIL] ${name}\n  Expected: ${expected}\n  Got:      ${result}`);
  }
}

console.log("Running Speech Interpreter Tests...\n");

const enInProfile: VoiceSpeechProfile = {
  language: "en",
  variant: "en-IN",
  confidence: "HIGH",
  source: "user",
};
const autoProfile: VoiceSpeechProfile = {
  language: "en",
  variant: "unknown",
  confidence: "UNKNOWN",
  source: "resolver",
};

// Test 1: Dictionary match with context
test(
  "Variant dictionary + Context (cap -> cab)",
  "book a cap to the airport",
  enInProfile,
  ["We", "need", "a", "cab"],
  "book a cab to the airport",
);

// Test 2: Dictionary match without context (should NOT correct)
test(
  "Variant dictionary + No Context (cap -> cap)",
  "book a cap to the airport",
  enInProfile,
  [],
  "book a cap to the airport",
);

// Test 3: Fuzzy matching for proper nouns with context
test(
  "Fuzzy match proper noun (TensorThrottle)",
  "how do I use tensor trottle",
  enInProfile,
  ["TensorThrottle", "is", "a", "project"],
  "how do I use TensorThrottle",
);

// Test 4: Fuzzy match proper noun (Kubernetes)
test(
  "Fuzzy match proper noun (Kubernetes)",
  "deploy to coobernetes",
  autoProfile,
  ["We", "use", "Kubernetes", "now"],
  "deploy to Kubernetes",
);

// Test 5: False correction (Uncertain transcript, no context)
test(
  "False correction test (no context)",
  "I went to the store",
  autoProfile,
  [],
  "I went to the store",
);

// Test 6: Short words should not trigger fuzzy match (e.g. less than 5 chars)
test(
  "Short word fuzzy match prevention (cat -> car)",
  "I drive a cat",
  autoProfile,
  ["car"],
  "I drive a cat",
);
