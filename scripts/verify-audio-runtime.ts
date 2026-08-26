import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkFile(filepath: string, rules: { forbidden?: RegExp[], required?: RegExp[] }) {
  const content = fs.readFileSync(filepath, 'utf8');
  let errors: string[] = [];

  rules.forbidden?.forEach(regex => {
    if (regex.test(content)) {
      errors.push(`Forbidden pattern found: ${regex.toString()}`);
    }
  });

  rules.required?.forEach(regex => {
    if (!regex.test(content)) {
      errors.push(`Required pattern missing: ${regex.toString()}`);
    }
  });

  if (errors.length > 0) {
    console.error(`\n[FAIL] ${filepath}`);
    errors.forEach(e => console.error(`  -> ${e}`));
    return false;
  }
  console.log(`[PASS] ${filepath}`);
  return true;
}

const PROVIDERS_DIR = path.join(__dirname, '../src/providers');
const filesToTest = [
  {
    path: path.join(PROVIDERS_DIR, 'gemini/useAudioPipeline.ts'),
    rules: {
      forbidden: [/navigator\.mediaDevices\.getUserMedia/],
      required: [/MicrophoneCoordinator\.getInstance\(\)/]
    }
  },
  {
    path: path.join(PROVIDERS_DIR, 'gemini/useWebSocket.ts'),
    rules: {
      forbidden: [/navigator\.mediaDevices\.getUserMedia/, /setupAudio\([^)]+\)/],
      required: [/setupAudio\(\)/]
    }
  },
  {
    path: path.join(PROVIDERS_DIR, 'sarvam/useSarvam.ts'),
    rules: {
      forbidden: [/navigator\.mediaDevices\.getUserMedia/, /new AudioContext\(/],
      required: [/MicrophoneCoordinator\.getInstance\(\)/, /getInputFrequencyData/]
    }
  },
  {
    path: path.join(PROVIDERS_DIR, 'openrouter/useProvider.ts'),
    rules: {
      forbidden: [/navigator\.mediaDevices\.getUserMedia/, /new AudioContext\(/],
      required: [/MicrophoneCoordinator\.getInstance\(\)/, /getInputFrequencyData/]
    }
  },
  {
    path: path.join(__dirname, '../src/hooks/useVoiceAcoustics.ts'),
    rules: {
      forbidden: [/requestAnimationFrame\(/],
      required: [/applyWorkletPerception/]
    }
  }
];

console.log("=========================================");
console.log("VERIFYING CANONICAL AUDIO RUNTIME (F.4.5)");
console.log("=========================================");

let allPass = true;
filesToTest.forEach(file => {
  if (fs.existsSync(file.path)) {
    const passed = checkFile(file.path, file.rules);
    if (!passed) allPass = false;
  } else {
    console.error(`[SKIP] File not found: ${file.path}`);
  }
});

if (!allPass) {
  console.error("\n[RESULT] AUDIO RUNTIME AUDIT FAILED.");
  process.exit(1);
} else {
  console.log("\n[RESULT] AUDIO RUNTIME AUDIT PASSED.");
  process.exit(0);
}
