import re

filepath = 'src/providers/openrouter/useProvider.ts'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Add import
if 'import { ToolExtractionService }' not in content:
    content = content.replace(
        'import { VoiceLanguageManager } from "@/core/voice-language/VoiceLanguageManager";',
        'import { VoiceLanguageManager } from "@/core/voice-language/VoiceLanguageManager";\nimport { ToolExtractionService } from "@/runtime/ToolExtractionService";'
    )

# 2. Add toolExtractorRef
content = content.replace(
    'export function useProvider(mode: string = "adaptive", voice: string = "Puck") {\n  // ── R01 FIX: Inactive guard — skip all resource allocation ──',
    'export function useProvider(mode: string = "adaptive", voice: string = "Puck") {\n  const toolExtractorRef = useRef(new ToolExtractionService());\n  // ── R01 FIX: Inactive guard — skip all resource allocation ──'
)

# 3. Fix extractStageDirections to drop JSON replacement completely
old_stage = """  // Extract JSON tool calls first
  const processedText = text.replace(/\\{\\s*"tool"\\s*:\\s*"play_music"[\\s\\S]*?\\}/g, (match) => {
    try {
      const data = JSON.parse(match);
      if (
        data.query ||
        data.mood ||
        data.activity ||
        data.genre ||
        data.intent === "similar" ||
        data.user_query
      ) {
        import("@/music/MusicService")
          .then(({ musicService }) => {
            musicService
              .processIntent({
                type: "play",
                query: data.query || data.user_query,
                mood: data.mood,
                energy: data.energy,
                genre: data.genre,
                activity: data.activity,
                intent: data.intent,
                ...(typeof data.start_at === "string" && data.start_at.trim()
                  ? { startAtSeconds: resolveSeekSeconds(data.start_at) }
                  : {}),
              })
              .catch((err) => console.error("[OpenRouter] Background play failed:", err));
          })
          .catch((err) => console.error("[OpenRouter] MusicService import failed:", err));
      }
    } catch (e) {}
    return "";
  });

  const cleanText = processedText.replace("""

new_stage = """  const cleanText = text.replace("""
content = content.replace(old_stage, new_stage)

# 4. Handle textBuffer reset
content = content.replace(
    '                    let textBuffer = "";',
    '                    toolExtractorRef.current.reset();\n                    let textBuffer = "";'
)

# 5. Handle first chunk loop
old_chunk = """                  const chunkText = data.text;
                  textBuffer += chunkText;
                  fullResponse += chunkText;
                  // Do not overwrite words to preserve user transcript

                  // MUSIC TOOL INTERCEPTOR: Prevent JSON blocks from being split by punctuation
                  if (textBuffer.includes("{") && !textBuffer.includes("}")) {
                    continue; // Wait for the closing brace before processing further
                  }

                  const toolMatch = textBuffer.match(/\\{\\s*"tool"\\s*:\\s*"play_music"/);
                  if (toolMatch) {
                    if (!textBuffer.includes("}")) {
                      continue; // Wait for the chunk with the closing brace
                    } else {
                      // Execute and strip the full JSON block
                      textBuffer = textBuffer.replace(
                        /\\{\\s*"tool"\\s*:\\s*"play_music"[\\s\\S]*?\\}/g,
                        (match) => {
                          try {
                            const data = JSON.parse(match);
                            if (
                              data.query ||
                              data.mood ||
                              data.activity ||
                              data.genre ||
                              data.intent === "similar" ||
                              data.user_query
                            ) {
                              import("@/music/MusicService").then(({ musicService }) => {
                                musicService.processIntent({
                                  type: "play",
                                  query: data.query || data.user_query,
                                  mood: data.mood,
                                  energy: data.energy,
                                  genre: data.genre,
                                  activity: data.activity,
                                  intent: data.intent,
                                });
                              });
                            }
                          } catch (e) {}
                          return "";
                        },
                      );
                      // Clean up lingering markdown ticks
                      textBuffer = textBuffer.replace(/```json|```/g, "").trimLeft();
                    }
                  }"""

new_chunk = """                  const chunkText = data.text;
                  const cleanChunk = toolExtractorRef.current.feed(chunkText);
                  const tools = toolExtractorRef.current.extractTools();
                  for (const tool of tools) {
                    if (tool.query || tool.mood || tool.activity || tool.genre || tool.intent === "similar" || tool.user_query) {
                      import("@/music/MusicService").then(({ musicService }) => {
                        musicService.processIntent({ type: "play", query: tool.query || tool.user_query, mood: tool.mood, energy: tool.energy, genre: tool.genre, activity: tool.activity, intent: tool.intent });
                      }).catch(e => {});
                    }
                  }
                  textBuffer += cleanChunk;
                  fullResponse += cleanChunk;
                  // Do not overwrite words to preserve user transcript"""
content = content.replace(old_chunk, new_chunk)

# 6. Handle currentBuffer reset
content = content.replace(
    '                let currentBuffer = "";',
    '                toolExtractorRef.current.reset();\n                let currentBuffer = "";'
)

# 7. Handle second chunk loop
old_chunk2 = """                currentBuffer += newText;
                completeResponse += newText;
                // Do not overwrite words to preserve user transcript

                // MUSIC TOOL INTERCEPTOR: Hold buffer if JSON tool block is being assembled
                if (currentBuffer.includes("{") && !currentBuffer.includes("}")) {
                  continue; // Wait for closing brace before sentence extraction
                }

                const toolStart = currentBuffer.match(/\\{\\s*"tool"\\s*:\\s*"play_music"/);
                if (toolStart) {
                  if (!currentBuffer.includes("}")) {
                    continue; // Wait for closing brace
                  }
                  // Full JSON block received — execute and strip
                  currentBuffer = currentBuffer.replace(
                    /\\{\\s*"tool"\\s*:\\s*"play_music"[\\s\\S]*?\\}/g,
                    (m) => {
                      try {
                        const d = JSON.parse(m);
                        if (
                          d.query ||
                          d.mood ||
                          d.activity ||
                          d.genre ||
                          d.intent === "similar" ||
                          d.user_query
                        ) {
                          import("@/music/MusicService").then(({ musicService }) => {
                            musicService.processIntent({
                              type: "play",
                              query: d.query || d.user_query,
                              mood: d.mood,
                              energy: d.energy,
                              genre: d.genre,
                              activity: d.activity,
                              intent: d.intent,
                            });
                          });
                        }
                      } catch (e) {}
                      return "";
                    },
                  );
                  currentBuffer = currentBuffer.replace(/```json|```/g, "").trimLeft();
                }"""

new_chunk2 = """                const newText = data.text;
                const cleanNewText = toolExtractorRef.current.feed(newText);
                const tools2 = toolExtractorRef.current.extractTools();
                for (const tool of tools2) {
                  if (tool.query || tool.mood || tool.activity || tool.genre || tool.intent === "similar" || tool.user_query) {
                    import("@/music/MusicService").then(({ musicService }) => {
                      musicService.processIntent({ type: "play", query: tool.query || tool.user_query, mood: tool.mood, energy: tool.energy, genre: tool.genre, activity: tool.activity, intent: tool.intent });
                    }).catch(e => {});
                  }
                }
                currentBuffer += cleanNewText;
                completeResponse += cleanNewText;
                // Do not overwrite words to preserve user transcript"""
                
# Wait, old_chunk2 didn't have `const newText = data.text;`. It had `currentBuffer += newText;`
# So we must replace the exact block correctly.
# Let's adjust new_chunk2
new_chunk2_adjusted = """                const cleanNewText = toolExtractorRef.current.feed(newText);
                const tools2 = toolExtractorRef.current.extractTools();
                for (const tool of tools2) {
                  if (tool.query || tool.mood || tool.activity || tool.genre || tool.intent === "similar" || tool.user_query) {
                    import("@/music/MusicService").then(({ musicService }) => {
                      musicService.processIntent({ type: "play", query: tool.query || tool.user_query, mood: tool.mood, energy: tool.energy, genre: tool.genre, activity: tool.activity, intent: tool.intent });
                    }).catch(e => {});
                  }
                }
                currentBuffer += cleanNewText;
                completeResponse += cleanNewText;
                // Do not overwrite words to preserve user transcript"""
content = content.replace(old_chunk2, new_chunk2_adjusted)

with open(filepath, 'w') as f:
    f.write(content)

