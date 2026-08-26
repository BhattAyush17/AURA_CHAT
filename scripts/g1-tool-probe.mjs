/**
 * G1 probe: verify gemini-3.1 Live session registers the 4 tools and
 * that the model calls playYouTubeMusic when given a clear text request.
 * Uses the SAME tools config as src/providers/gemini/useWebSocket.ts.
 */
import { GoogleGenAI, Modality, Type } from "@google/genai";

const key = process.env.GEMINI_KEY || "";
const ai = new GoogleGenAI({ apiKey: key });

let session;

const done = setTimeout(() => {
  console.log("RESULT: timeout after 30s — no toolCall seen");
  process.exit(0);
}, 30000);

const onmessage = async (msg) => {
  if (msg.toolCall?.functionCalls) {
    for (const fc of msg.toolCall.functionCalls) {
      console.log("TOOLCALL:", fc.name, JSON.stringify(fc.args ?? {}));
    }
    if (msg.toolCall.functionCalls.some((f) => f.name === "playYouTubeMusic")) {
      console.log("RESULT: playYouTubeMusic requested — sending response");
      await session.sendRealtimeInput({
        functionResponses: msg.toolCall.functionCalls.map((fc) => ({
          id: fc.id,
          name: fc.name,
          response: { result: "Playing on YouTube." },
        })),
      });
      console.log("RESULT: response sent — model should continue");
      setTimeout(() => process.exit(0), 6000);
    } else {
      process.exit(0);
    }
  }
  if (msg.serverContent?.inputTranscription?.text) {
    console.log("INPUT:", msg.serverContent.inputTranscription.text);
  }
  if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
    console.log("AUDIO reply received");
  }
};

session = await ai.live.connect({
  model: "models/gemini-3.1-flash-live-preview",
  config: {
    responseModalities: [Modality.AUDIO],
    realtimeInputConfig: {
      automaticActivityDetection: { disabled: false },
    },
    tools: [
      {
        functionDeclarations: [
          {
            name: "saveMemory",
            parameters: {
              type: Type.OBJECT,
              properties: { fact: { type: Type.STRING } },
              required: ["fact"],
            },
          },
          {
            name: "updateAnalysis",
            parameters: {
              type: Type.OBJECT,
              properties: {
                user_words: { type: Type.STRING },
                detected_tone: { type: Type.STRING },
                perceived_intent: { type: Type.STRING },
              },
              required: ["user_words", "detected_tone", "perceived_intent"],
            },
          },
          {
            name: "playYouTubeMusic",
            description: "Plays a requested song or music on YouTube instantly.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                query: {
                  type: Type.STRING,
                  description: "The song name and artist to search and play",
                },
              },
              required: ["query"],
            },
          },
          {
            name: "stopYouTubeMusic",
            description: "Stops or closes the currently playing YouTube music.",
          },
        ],
      },
    ],
  },
  callbacks: { onmessage },
});

console.log("CONNECTED — sending text request");
await session.sendRealtimeInput({
  text: "Play something calm on YouTube for me, please.",
});
