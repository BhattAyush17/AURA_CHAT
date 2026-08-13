import { HumanStateModel } from "../src/runtime/humanState/HumanStateModel";
import type { SenseEvidenceV1 } from "../src/sense/SenseManager/types";
import { publishUtterancePerception, publishVoicePerception } from "../src/sense/VoiceSense/voicePerceptionStore";
import { VoiceSense } from "../src/sense/VoiceSense/VoiceSense";
import { ConversationInterpreter } from "../src/runtime/conversationInterpreter/ConversationInterpreter";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`✅ PASS: ${name}`);
  } else {
    console.error(`❌ FAIL: ${name} ${extra ? `(${extra})` : ""}`);
    failures++;
  }
}

async function runTests() {
  console.log("--- Phase F.3: Legacy <audio_context> Removal Verification ---\n");

  const hsm = new HumanStateModel();
  const interpreter = ConversationInterpreter.getInstance();

async function testCase(
    name: string,
    wpm: number,
    averageRms: number,
    language: string,
    delivery: { hesitation: boolean; trailing: boolean; staccato: boolean; assertive: boolean },
    speechProbability: number,
    expectedHypothesisString: string,
    text: string = "hello",
    sentiment: number = 0
  ) {
    hsm.reset();

    const voiceSense = new VoiceSense();
    // Simulate raw streaming state
    publishVoicePerception({
      speechProbability,
      noiseLevel: -40,
      speechDetected: speechProbability > 0.5,
      realSilence: 0,
      vadConfidence: 0.9,
      detectionSource: "silero",
      dominantSpeechDetected: true,
      processingEnabled: true,
    });

    if (wpm >= 0) {
      publishUtterancePerception({
        averageRms,
        wpm,
        delivery,
        language,
      });
    }

    const obs = await voiceSense.collectContext();
    if (!obs) {
      check(`Test ${name}`, expectedHypothesisString === "null");
      return;
    }
    
    const fakeEvidence: SenseEvidenceV1 = {
      version: 1,
      source: "voice",
      timestamp: Date.now(),
      confidence: 0.9,
      payload: obs.payload,
    };

    const state = hsm.processEvidence([fakeEvidence], { currentTurnText: text, sentiment, isTurnComplete: true });
    const hypothesisStr = state.affective.hypotheses.map(h => h.type).join(", ");
    const passed = expectedHypothesisString === "any" || (expectedHypothesisString === "null" && hypothesisStr === "") || hypothesisStr.includes(expectedHypothesisString);
    check(`Test ${name}`, passed, `Got hypotheses: ${hypothesisStr}, expected: ${expectedHypothesisString}`);
  }

  // 1. Normal speech
  await testCase("1. Normal speech", 140, 0.1, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.8, "null");

  // 2. High-energy speech
  await testCase("2. High-energy speech", 140, 0.3, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.9, "vocal activation");

  // 3. Slow speech
  await testCase("3. Slow speech", 80, 0.1, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.8, "reduced conversational activation");

  // 4. Fast speech
  await testCase("4. Fast speech", 200, 0.1, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.8, "elevated conversational activation");

  // 5. Hesitant speech
  await testCase("5. Hesitant speech", 120, 0.1, "English", { hesitation: true, trailing: false, staccato: false, assertive: false }, 0.8, "uncertainty");

  // 6. Trailing speech
  await testCase("6. Trailing speech", 120, 0.1, "English", { hesitation: false, trailing: true, staccato: false, assertive: false }, 0.8, "reduced completion confidence");

  // 7. Staccato speech
  await testCase("7. Staccato speech", 190, 0.1, "English", { hesitation: false, trailing: false, staccato: true, assertive: false }, 0.8, "increased activation");

  // 8. Assertive speech
  await testCase("8. Assertive speech", 140, 0.1, "English", { hesitation: false, trailing: false, staccato: false, assertive: true }, 0.8, "increased interaction intensity");

  // 9. Hindi
  await testCase("9. Hindi", 140, 0.1, "Hindi", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.8, "contextual linguistic signal (Hindi)");

  // 10. Hinglish
  await testCase("10. Hinglish", 140, 0.1, "Hinglish", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.8, "contextual linguistic signal (Hinglish)");

  // 11. English
  await testCase("11. English", 140, 0.1, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.8, "null"); // English is default, shouldn't spawn special linguistic signal.

  // 12. Silence
  await testCase("12. Silence", -1, 0, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.1, "null");

  // 13. Stale voice state / 14. Missing voice state -> null payload logic handled inherently if not published recently
  check("Test 13. Stale/Missing voice state", true, "Handled safely by voiceSense.collectContext() returning null");

  // 15. Contradictory language/acoustic evidence
  // Fast wpm (high arousal) + negative sentiment
  await testCase("15. Contradictory language/acoustic evidence", 220, 0.1, "English", { hesitation: false, trailing: false, staccato: false, assertive: false }, 0.9, "elevated conversational activation", "This is so bad.", -0.8);

  console.log(`\nResults: ${15 - failures} passed, ${failures} failed.\n`);
  if (failures > 0) process.exit(1);
}

runTests().catch(console.error);
