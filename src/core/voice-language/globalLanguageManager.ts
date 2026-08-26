import { VoiceLanguageManager } from "./VoiceLanguageManager";

// Initialize the global singleton with the user's saved preference, or default to hi-IN
const defaultLanguage = typeof localStorage !== 'undefined' ? (localStorage.getItem('aura_voice_language') || "hi-IN") : "hi-IN";

export const globalLanguageManager = new VoiceLanguageManager(defaultLanguage);

// Initialize with saved speech preference if available
const speechPref = typeof localStorage !== 'undefined' ? (localStorage.getItem('aura_speech_accent') as any) || "Automatic" : "Automatic";
globalLanguageManager.setSpeechPreference(speechPref);
