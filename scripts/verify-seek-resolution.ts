/**
 * Headless verification of the playback-position resolution logic added for
 * precise music control. Exercised with `npx tsx scripts/verify-seek-resolution.ts`.
 *
 * The audio-element (HTMLAudioPlaybackProvider) behavior cannot run headless —
 * HTMLMediaElement requires a browser. Here we verify the pure resolution layer
 * (timestamps, named sections, lyric-line best-effort) that feeds the seek path.
 */
import { parseTimestampToSeconds, resolvePositionTarget } from "../src/music/DeicticResolver";

const fakeTrack: any = {
  id: "t1",
  title: "Running Away",
  artist: "Test Artist",
  durationMs: 240000,
  source: "youtube",
  chapters: [
    { title: "Intro", start_time: 0, end_time: 15 },
    { title: "Verse 1", start_time: 15, end_time: 45 },
    { title: "Chorus", start_time: 45, end_time: 75 },
    { title: "Bridge", start_time: 120, end_time: 150 },
    { title: "Outro", start_time: 210, end_time: 240 },
  ],
};

let pass = 0;
let fail = 0;

function check(name: string, actual: number | null, expected: number | null) {
  const ok = actual === expected;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${actual}, want ${expected}`);
}

function checkReason(actual: string | undefined) {
  // Just ensure a reason string exists (non-empty) for honesty reporting.
  return typeof actual === "string" && actual.length > 0;
}

console.log("── Timestamp parsing ─────────────────────────────");
check("parse 1:32", parseTimestampToSeconds("1:32"), 92);
check("parse start at 1:32", parseTimestampToSeconds("start at 1:32"), 92);
check("parse 01:32", parseTimestampToSeconds("01:32"), 92);
check("parse 0:45", parseTimestampToSeconds("0:45"), 45);
check("parse 92 seconds", parseTimestampToSeconds("92 seconds"), 92);
check("parse 3 minutes", parseTimestampToSeconds("3 minutes"), 180);
check("parse 1 minute 30 seconds", parseTimestampToSeconds("1 minute 30 seconds"), 90);
check("parse invalid clock 99:99", parseTimestampToSeconds("99:99"), null);
check("parse no time in sentence", parseTimestampToSeconds("play the chorus"), null);

console.log("── Position resolution (explicit timestamp) ──────");
const ts = resolvePositionTarget("1:32", fakeTrack);
check("resolve 1:32", ts.seconds, 92);
if (ts.source !== "timestamp") {
  fail++;
  console.log("FAIL  ts.source == timestamp");
} else pass++;

console.log("── Section resolution against chapters ───────────");
const chorus = resolvePositionTarget("the chorus", fakeTrack);
check("resolve 'the chorus'", chorus.seconds, 45);
if (chorus.source !== "section") {
  fail++;
  console.log("FAIL  chorus.source == section");
} else pass++;

const bridge = resolvePositionTarget("from the bridge", fakeTrack);
check("resolve 'from the bridge'", bridge.seconds, 120);

const intro = resolvePositionTarget("the intro", fakeTrack);
check("resolve 'the intro'", intro.seconds, 0);

const outro = resolvePositionTarget("the outro", fakeTrack);
check("resolve 'the outro'", outro.seconds, 210);

console.log("── Section without chapter metadata (honest null) ─");
const noChapterTrack: any = {
  id: "t2",
  title: "NoChapters",
  artist: "X",
  durationMs: 100000,
  source: "youtube",
};
const noCh = resolvePositionTarget("the chorus", noChapterTrack);
check("chorus w/o chapters -> null", noCh.seconds, null);
if (noCh.source !== "section") {
  fail++;
  console.log("FAIL  noCh.source == section");
} else pass++;
if (!checkReason(noCh.reason)) {
  fail++;
  console.log("FAIL  noCh.reason non-empty");
} else pass++;

console.log("── Lyric line (matches section title) ────────────");
// A lyric line containing a section keyword resolves to that section's start
// (section detection takes precedence over free-text lyric search).
const lyricMatch = resolvePositionTarget("from the line chorus", fakeTrack);
if (lyricMatch.seconds === 45) {
  pass++;
} else {
  fail++;
  console.log(`FAIL  lyricMatch: ${JSON.stringify(lyricMatch)}`);
}

console.log("── Lyric line (no match -> honest null) ──────────");
const lyricMiss = resolvePositionTarget("from the line i will always love you", fakeTrack);
if (lyricMiss.seconds === null && lyricMiss.source === "lyric") {
  pass++;
} else {
  fail++;
  console.log(`FAIL  lyricMiss: ${JSON.stringify(lyricMiss)}`);
}
if (!checkReason(lyricMiss.reason)) {
  fail++;
  console.log("FAIL  lyricMiss.reason non-empty");
} else pass++;

console.log("── Empty / unresolvable ─────────────────────────");
const empty = resolvePositionTarget("", fakeTrack);
if (empty.seconds === null) {
  pass++;
} else {
  fail++;
  console.log("FAIL  empty -> null");
}

console.log("\n══════════════════════════════════════════════════");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
