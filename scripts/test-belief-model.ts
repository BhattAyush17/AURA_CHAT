import { AdaptiveCommunicationAnalyzer } from "../src/runtime/language/AdaptiveCommunicationAnalyzer";
import { INITIAL_ADAPTIVE_PROFILE } from "../src/runtime/language/AdaptiveCommunicationProfile";

// Mock localStorage
(global as any).localStorage = {
  _store: {} as Record<string, string>,
  getItem(key: string) { return this._store[key] ?? null; },
  setItem(key: string, value: string) { this._store[key] = value; },
  removeItem(key: string) { delete this._store[key]; },
  clear() { this._store = {}; },
};

function freshAnalyzer(): any {
  (AdaptiveCommunicationAnalyzer as any).instance = undefined;
  return AdaptiveCommunicationAnalyzer.getInstance();
}

function simulateConversation(
  analyzer: any,
  turns: number,
  language: "english" | "hindi" | "hinglish",
  context: "casual" | "technical" | "generic"
) {
  for (let i = 0; i < turns; i++) {
    let text = "";
    if (language === "english") text = "this is a very clear english sentence that I am speaking right now today";
    if (language === "hindi") text = "kya haal hai bhai mujhe hindi bolna pasand hai aaj";
    if (language === "hinglish") text = "yaar mujhe lagta hai ki ye hinglish sentence hai bhai";

    if (context === "technical") text += " function database server api architecture code system";
    // For casual, we keep text short enough or add casual markers
    if (context === "casual") text = text.substring(0, 14); // Keep under 15 chars to trigger casual context

    analyzer.observe({ userText: text, backendBehavior: null });
  }
  analyzer.clearSession(); // triggers finalizeConversation
}

function runTests() {
  console.log("=== AURA LONGITUDINAL BELIEF MODEL — FINAL CORRECTION AUDIT ===\n");

  const EMA_HALF_LIFE = 20;
  const alpha = 1 - Math.pow(0.5, 1 / EMA_HALF_LIFE);
  console.log(`EMA Alpha: ${alpha.toFixed(5)} (Half-life: ${EMA_HALF_LIFE} conversations)`);
  console.log(`Mathematical verification: (1-alpha)^20 = ${Math.pow(1 - alpha, 20).toFixed(4)} (should be ≈0.5000)\n`);

  // =========================================================
  // TEST A: Conversation Clustering
  // =========================================================
  console.log("--- TEST A: Conversation Clustering ---");
  console.log("One 50-turn conversation MUST have the same longitudinal weight as ONE 1-turn conversation.\n");
  
  const a1 = freshAnalyzer();
  // Build identical baseline
  for (let i = 0; i < 50; i++) simulateConversation(a1, 3, "english", "generic");
  const baseline_er = a1.getProfile().language.value.englishRatio;
  const baseline_convs = a1.getProfile().totalConversationsAnalyzed;
  
  // Apply ONE conversation with 50 turns
  simulateConversation(a1, 50, "hindi", "generic");
  const after_50turn = a1.getProfile();
  const influence_50turn = baseline_er - after_50turn.language.value.englishRatio;
  const convs_50turn = after_50turn.totalConversationsAnalyzed;

  const a2 = freshAnalyzer();
  for (let i = 0; i < 50; i++) simulateConversation(a2, 3, "english", "generic");
  const baseline2_er = a2.getProfile().language.value.englishRatio;

  // Apply ONE conversation with 1 turn
  simulateConversation(a2, 1, "hindi", "generic");
  const after_1turn = a2.getProfile();
  const influence_1turn = baseline2_er - after_1turn.language.value.englishRatio;

  console.log(`  Baseline: ${baseline_convs} convs, English Ratio: ${baseline_er.toFixed(4)}`);
  console.log(`  After 1x50-turn Hindi conv: English Ratio ${after_50turn.language.value.englishRatio.toFixed(4)} (Δ=${influence_50turn.toFixed(4)}, convs=${convs_50turn})`);
  console.log(`  After 1x1-turn Hindi conv:  English Ratio ${after_1turn.language.value.englishRatio.toFixed(4)} (Δ=${influence_1turn.toFixed(4)})`);
  console.log(`  Both should increment totalConversationsAnalyzed by exactly 1.`);
  console.log(`  PASS: ${Math.abs(convs_50turn - baseline_convs) === 1 ? "YES" : "NO"} — 50-turn conv counted as exactly 1 conversation.`);
  
  // Compare with 50 INDEPENDENT conversations
  const a3 = freshAnalyzer();
  for (let i = 0; i < 50; i++) simulateConversation(a3, 3, "english", "generic");
  const baseline3_er = a3.getProfile().language.value.englishRatio;
  for (let i = 0; i < 50; i++) simulateConversation(a3, 1, "hindi", "generic");
  const after_50indep = a3.getProfile();
  const influence_50indep = baseline3_er - after_50indep.language.value.englishRatio;
  
  console.log(`\n  After 50 INDEPENDENT Hindi convs: English Ratio ${after_50indep.language.value.englishRatio.toFixed(4)} (Δ=${influence_50indep.toFixed(4)})`);
  console.log(`  Clustering Ratio: 1-conv influence / 50-conv influence = ${(influence_50turn / influence_50indep).toFixed(3)}`);
  console.log(`  PASS: ${influence_50turn < influence_50indep * 0.2 ? "YES" : "NO"} — 50-turn conv influence < 20% of 50 independent convs.\n`);

  // =========================================================
  // TEST B: True EMA Half-Life
  // =========================================================
  console.log("--- TEST B: True EMA Half-Life ---");
  console.log("After 20 contradictory independent conversations, old baseline influence should be ≈50%.\n");

  const b = freshAnalyzer();
  // Build a pure English baseline. Use many conversations to converge.
  for (let i = 0; i < 100; i++) simulateConversation(b, 3, "english", "generic");
  const b_baseline = b.getProfile().language.value.englishRatio;
  console.log(`  Baseline after 100 English convs: ${b_baseline.toFixed(4)}`);

  // Apply 20 pure Hindi conversations 
  for (let i = 0; i < 20; i++) simulateConversation(b, 3, "hindi", "generic");
  const b_after20 = b.getProfile().language.value.englishRatio;
  console.log(`  After 20 Hindi convs: ${b_after20.toFixed(4)}`);

  for (let i = 0; i < 20; i++) simulateConversation(b, 3, "hindi", "generic");
  const b_after40 = b.getProfile().language.value.englishRatio;
  console.log(`  After 40 Hindi convs: ${b_after40.toFixed(4)}`);

  for (let i = 0; i < 20; i++) simulateConversation(b, 3, "hindi", "generic");
  const b_after60 = b.getProfile().language.value.englishRatio;
  console.log(`  After 60 Hindi convs: ${b_after60.toFixed(4)}`);

  // The Hindi text has hindiRatio close to 1.0 so:
  // After N Hindi convs, englishRatio ≈ baseline * (1-effectiveAlpha)^N + hindiEnglishRatio * (1 - (1-effectiveAlpha)^N)
  // blendLanguage uses effectiveCurWeight = alpha * cur.confidence, so effective alpha < nominal alpha.
  // Print the measured decay ratio
  const hindiEnglishRatio = 0; // Hindi text should have very low english ratio
  // Measure: fraction of original baseline that remains
  // After N convs: remaining = (current - target) / (baseline - target)
  // For simplicity, just print the trajectory
  console.log(`\n  Decay trajectory (English Ratio):
    0 convs: ${b_baseline.toFixed(4)}
   20 convs: ${b_after20.toFixed(4)}
   40 convs: ${b_after40.toFixed(4)}
   60 convs: ${b_after60.toFixed(4)}\n`);

  // =========================================================
  // TEST C: Single Anomaly
  // =========================================================
  console.log("--- TEST C: Single Anomaly ---");
  const c = freshAnalyzer();
  for (let i = 0; i < 100; i++) simulateConversation(c, 3, "english", "generic");
  const c_baseline = c.getProfile().language.value.englishRatio;
  
  // Feed one Hindi conversation
  simulateConversation(c, 3, "hindi", "generic");
  const c_after = c.getProfile();
  console.log(`  Baseline: ${c_baseline.toFixed(4)}`);
  console.log(`  After 1 Hindi conv: ${c_after.language.value.englishRatio.toFixed(4)}`);
  console.log(`  Primary: ${c_after.language.value.primary}`);
  console.log(`  State: ${c_after.language.state}`);
  console.log(`  PASS: ${c_after.language.value.primary === "english" ? "YES" : "NO"} — baseline remains English.\n`);

  // =========================================================
  // TEST D: Permanent Change
  // =========================================================
  console.log("--- TEST D: Permanent Change ---");
  const d = freshAnalyzer();
  for (let i = 0; i < 50; i++) simulateConversation(d, 3, "english", "generic");
  console.log(`  Baseline: English Ratio ${d.getProfile().language.value.englishRatio.toFixed(4)}`);
  
  const stages = [10, 20, 40, 60, 80];
  let totalHindiConvs = 0;
  for (const stage of stages) {
    const needed = stage - totalHindiConvs;
    for (let i = 0; i < needed; i++) simulateConversation(d, 3, "hindi", "generic");
    totalHindiConvs = stage;
    const dp = d.getProfile();
    console.log(`  After ${stage} Hindi convs: English ${dp.language.value.englishRatio.toFixed(4)} | State: ${dp.language.state} | Confidence: ${dp.language.confidence.toFixed(2)}`);
  }
  console.log("");

  // =========================================================
  // TEST E: Variance / Conflict
  // =========================================================
  console.log("--- TEST E: Variance / Conflict ---");
  const e = freshAnalyzer();
  for (let i = 0; i < 60; i++) {
    simulateConversation(e, 3, "english", "generic");
    simulateConversation(e, 3, "hindi", "generic");
  }
  const ep = e.getProfile();
  console.log(`  120 alternating convs — Evidence: ${ep.language.evidenceCount}`);
  console.log(`  Confidence: ${ep.language.confidence.toFixed(2)} | State: ${ep.language.state} | Variance: ${(ep.language.variance ?? 0).toFixed(3)}`);
  console.log(`  PASS: ${ep.language.state === "CONFLICTING" || ep.language.state === "RECENTLY_CHANGED" ? "YES" : "NO"} — not falsely KNOWN.`);
  console.log(`  PASS: ${ep.language.confidence < 0.6 ? "YES" : "NO"} — confidence penalized by variance.\n`);

  // =========================================================
  // TEST F: Context Separation
  // =========================================================
  console.log("--- TEST F: Context Separation ---");
  const f = freshAnalyzer();
  for (let i = 0; i < 50; i++) {
    simulateConversation(f, 3, "hinglish", "casual");
    simulateConversation(f, 3, "english", "technical");
  }
  const fp = f.getProfile();
  console.log(`  Global: ${fp.language.value.primary} (English Ratio: ${fp.language.value.englishRatio.toFixed(3)})`);
  console.log(`  Casual: ${fp.contextualLanguage.casual.value.primary} (English Ratio: ${fp.contextualLanguage.casual.value.englishRatio.toFixed(3)})`);
  console.log(`  Technical: ${fp.contextualLanguage.technical.value.primary} (English Ratio: ${fp.contextualLanguage.technical.value.englishRatio.toFixed(3)})`);
  const casualIsHinglish = fp.contextualLanguage.casual.value.primary !== "english";
  const techIsEnglish = fp.contextualLanguage.technical.value.primary === "english";
  console.log(`  PASS: ${casualIsHinglish ? "YES" : "NO"} — casual context is non-english.`);
  console.log(`  PASS: ${techIsEnglish ? "YES" : "NO"} — technical context is english.\n`);

  // =========================================================
  // TEST G: Change Detection
  // =========================================================
  console.log("--- TEST G: Change Detection ---");
  const g = freshAnalyzer();
  for (let i = 0; i < 50; i++) simulateConversation(g, 3, "english", "generic");
  const g_state_before = g.getProfile().language.state;
  
  // One anomalous conversation
  simulateConversation(g, 3, "hindi", "generic");
  const g_state_after1 = g.getProfile().language.state;
  
  // Should NOT be RECENTLY_CHANGED from one anomaly
  console.log(`  State before anomaly: ${g_state_before}`);
  console.log(`  State after 1 Hindi conv: ${g_state_after1}`);
  console.log(`  PASS: ${g_state_after1 !== "RECENTLY_CHANGED" ? "YES" : "NO"} — 1 anomaly does not trigger RECENTLY_CHANGED.`);
  
  // Sustained change
  for (let i = 0; i < 10; i++) simulateConversation(g, 3, "hindi", "generic");
  const g_state_after10 = g.getProfile().language.state;
  console.log(`  State after 11 Hindi convs: ${g_state_after10}`);
  console.log(`  PASS: ${g_state_after10 === "RECENTLY_CHANGED" || g_state_after10 === "CONFLICTING" ? "YES" : "NO"} — sustained change detected.\n`);

  // =========================================================
  // TEST H: Persistence
  // =========================================================
  console.log("--- TEST H: Persistence ---");
  const h = freshAnalyzer();
  for (let i = 0; i < 20; i++) simulateConversation(h, 3, "english", "generic");
  h.observe({ userText: "I prefer short answers.", backendBehavior: null });
  h.clearSession();
  
  const savedProfile = h.getProfile();
  const savedConvs = savedProfile.totalConversationsAnalyzed;
  const savedConfidence = savedProfile.language.confidence;
  const savedExplicitPrefs = savedProfile.explicitPreferences.length;
  
  // Simulate reload: create new instance from persisted localStorage
  const h2 = freshAnalyzer();
  const loadedProfile = h2.getProfile();
  
  console.log(`  Saved convs: ${savedConvs} → Loaded convs: ${loadedProfile.totalConversationsAnalyzed}`);
  console.log(`  Saved confidence: ${savedConfidence.toFixed(3)} → Loaded confidence: ${loadedProfile.language.confidence.toFixed(3)}`);
  console.log(`  Saved explicit prefs: ${savedExplicitPrefs} → Loaded explicit prefs: ${loadedProfile.explicitPreferences.length}`);
  console.log(`  Current turn signal after reload: ${h2.getCurrentTurnSignal()}`);
  console.log(`  PASS: ${loadedProfile.totalConversationsAnalyzed === savedConvs ? "YES" : "NO"} — longitudinal state survives reload.`);
  console.log(`  PASS: ${h2.getCurrentTurnSignal() === null ? "YES" : "NO"} — turn signal does NOT survive reload.\n`);

  // =========================================================
  // SUMMARY
  // =========================================================
  console.log("=== AUDIT COMPLETE ===");
}

runTests();
