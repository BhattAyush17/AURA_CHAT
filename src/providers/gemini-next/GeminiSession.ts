import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VoiceEngineConfig, VoiceEngineEvents, GeminiSessionState } from "./GeminiTypes";
import { buildMusicContext } from "@/lib/aura-actions";

export class GeminiSession {
  private session: any = null;
  private config: VoiceEngineConfig;
  private events: VoiceEngineEvents;
  private state: GeminiSessionState = "IDLE";
  private currentConnectPromise: Promise<void> | null = null;

  constructor(config: VoiceEngineConfig, events: VoiceEngineEvents) {
    this.config = config;
    this.events = events;
  }

  public getState(): GeminiSessionState {
    return this.state;
  }

  private setState(newState: GeminiSessionState) {
    this.state = newState;
    this.events.onStateChange?.(newState);
  }

  public async connect(): Promise<void> {
    if (this.state === "CONNECTING" || this.state === "CONNECTED") {
      return this.currentConnectPromise || Promise.resolve();
    }

    this.setState("CONNECTING");

    this.currentConnectPromise = new Promise<void>(async (resolve, reject) => {
      try {
        const ai = new GoogleGenAI({
          apiKey: this.config.apiKey,
          httpOptions: { apiVersion: "v1beta" },
        });

        const isNativeAudio =
          this.config.model.includes("gemini-2.0") || this.config.model.includes("gemini-3.");

        this.session = await ai.live.connect({
          model: this.config.model,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
              ...(isNativeAudio ? {} : { languageCode: this.config.language || "en-US" }),
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH" as any,
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW" as any,
                prefixPaddingMs: 20,
                silenceDurationMs: 1300,
              },
            },
            systemInstruction: (() => {
              let instruction = this.config.systemInstruction || "";
              const activeMusicCtx = buildMusicContext();
              const regex = /\[ACTIVE MUSIC CONTEXT\][\s\S]*?\[\/ACTIVE MUSIC CONTEXT\]/;
              if (regex.test(instruction)) {
                instruction = instruction.replace(regex, activeMusicCtx);
              } else if (activeMusicCtx) {
                instruction = instruction ? `${instruction}\n\n${activeMusicCtx}` : activeMusicCtx;
              }
              return instruction ? { parts: [{ text: instruction }] } : undefined;
            })(),
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
                          description: "The song name and artist to search and play (optional)",
                        },
                        mood: {
                          type: Type.STRING,
                          description: "The mood of the music (e.g. calm, energetic)",
                        },
                        energy: {
                          type: Type.STRING,
                          description: "The energy level (e.g. low, high)",
                        },
                        genre: {
                          type: Type.STRING,
                          description: "The genre of the music",
                        },
                        activity: {
                          type: Type.STRING,
                          description: "The activity the music is for (e.g. workout, focus)",
                        },
                        intent: {
                          type: Type.STRING,
                          description: "explicit_song | mood_based | contextual | similar | preference_based",
                        },
                      },
                      required: [],
                    },
                  },
                  {
                    name: "stopYouTubeMusic",
                    description: "Stops or closes the currently playing YouTube music.",
                  },
                  {
                    name: "getMusicContext",
                    description: "Gets the current authoritative playing music track, playback state, queue, and history from runtime. Call this tool when the user asks about: current music, current song, artist, song identity, previous or next songs, playback state, queue, song history, references like 'this song', 'it', 'that track', 'the previous one', or before modifications depending on knowing the current track. Do not guess the track; call this tool for actual state.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {},
                    },
                  },
                ],
              },
            ],
          },
          callbacks: {
            onopen: () => {
              this.setState("CONNECTED");
              resolve();
            },
            onmessage: (msg: any) => this.handleMessage(msg),
            onclose: (event: any) => {
              this.handleClose(event);
            },
            onerror: (err: any) => {
              this.handleError(err);
              if (this.state === "CONNECTING") {
                reject(err);
              }
            },
          },
        });
      } catch (err: any) {
        this.setState("ERROR");
        this.events.onError?.(err);
        reject(err);
      }
    });

    return this.currentConnectPromise;
  }

  public disconnect(): void {
    if (this.state === "CLOSED" || this.state === "IDLE") return;
    this.setState("DISCONNECTING");
    try {
      this.session?.close?.();
    } catch (e) {
      // Ignore
    }
    this.session = null;
    this.setState("CLOSED");
  }

  public sendRealtimeInput(data: any): void {
    if (this.state !== "CONNECTED" || !this.session) return;
    try {
      this.session.sendRealtimeInput(data);
    } catch (e) {
      console.warn("[GeminiSession] Failed to send realtime input:", e);
    }
  }

  public sendClientContent(data: any): void {
    if (this.state !== "CONNECTED" || !this.session) return;
    try {
      this.session.sendClientContent(data);
    } catch (e) {
      console.warn("[GeminiSession] Failed to send client content:", e);
    }
  }

  private handleMessage(msg: any) {
    if (msg.goAway) {
      console.warn("[GeminiSession] Received goAway from server");
      this.events.onGoAway?.();
      return;
    }

    if (msg.serverContent) {
      if (msg.serverContent.inputTranscription?.text) {
        this.events.onInputTranscription?.(msg.serverContent.inputTranscription.text);
      }

      if (msg.serverContent.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part?.text) {
            this.events.onModelText?.(part.text);
          }
          if (part?.inlineData?.data) {
            this.events.onAudioChunkReceived?.(part.inlineData.data);
          }
        }
      }

      if (msg.serverContent.turnComplete || msg.serverContent.generationComplete) {
        this.events.onTurnComplete?.();
      }

      if (msg.serverContent.interrupted) {
        this.events.onInterrupted?.();
      }
    }

    if (msg.usageMetadata) {
      this.events.onUsageMetadata?.(msg.usageMetadata);
    }

    if (msg.toolCall?.functionCalls && this.events.onToolCall) {
      const functionCalls = msg.toolCall.functionCalls;
      this.events.onToolCall(functionCalls).then((resps) => {
        if (this.session?.sendToolResponse) {
          this.session.sendToolResponse({ functionResponses: resps });
        } else if (this.session) {
          this.session.sendClientContent({
            toolResponse: { functionResponses: resps },
          });
        }
      });
    }
  }

  private handleClose(event: any) {
    console.warn(`[GeminiSession] WebSocket closed. Code: ${event?.code}, Reason: ${event?.reason}`);
    this.session = null;
    if (event?.code && event.code !== 1000 && event.code !== 1005) {
      const errMsg = event.reason || `WebSocket closed with code ${event.code}`;
      this.setState("ERROR");
      this.events.onError?.(new Error(errMsg));
    } else {
      this.setState("CLOSED");
    }
  }

  private handleError(err: any) {
    console.error(`[GeminiSession] WebSocket error:`, err);
    this.setState("ERROR");
    this.events.onError?.(err);
  }
}
