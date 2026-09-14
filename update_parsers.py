import re

def update_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Add import
    import_statement = 'import { ToolExtractionService } from "@/runtime/ToolExtractionService";\n'
    if import_statement not in content:
        content = re.sub(
            r'(import .*?\n)',
            r'\1' + import_statement,
            content,
            count=1
        )

    # 2. Instantiate toolExtractorRef in the hook
    hook_def = re.search(r'export function use[a-zA-Z]+\(.*?\)\s*\{', content)
    if hook_def:
        hook_str = hook_def.group(0)
        content = content.replace(
            hook_str,
            hook_str + '\n  const toolExtractorRef = useRef(new ToolExtractionService());'
        )

    # 3. Replace extractStageDirections JSON part
    # It currently does:
    # const processedText = text.replace(/\{\s*"tool"\s*:\s*"play_music"[\s\S]*?\}/g, (match) => { ... });
    # We can just remove it or let it be (since it won't find JSON anymore if it's stripped)
    # But let's remove the JSON extraction from extractStageDirections to avoid duplicate execution.
    content = re.sub(
        r'// Extract JSON tool calls first.*?const processedText = text\.replace\(/\\\{\\s\*"tool"\\s\*:\\s\*"play_music"\[\\s\\S\]\*\?\\}/g, \(match\) => \{.*?\n\s+return "";\n\s+\}\);\n\n\s+const cleanText = processedText',
        'const cleanText = text',
        content,
        flags=re.DOTALL
    )

    # 4. Find all stream text chunks and apply ToolExtractionService
    # They look like:
    # const chunkText = data.text;
    # textBuffer += chunkText;
    # fullResponse += chunkText;
    
    # We replace it with:
    # const chunkText = data.text;
    # const cleanChunk = toolExtractorRef.current.feed(chunkText);
    # const tools = toolExtractorRef.current.extractTools();
    # for (const tool of tools) {
    #   if (tool.query || tool.mood || tool.activity || tool.genre || tool.intent === "similar" || tool.user_query) {
    #     import("@/music/MusicService").then(({ musicService }) => {
    #       musicService.processIntent({ type: "play", query: tool.query || tool.user_query, mood: tool.mood, energy: tool.energy, genre: tool.genre, activity: tool.activity, intent: tool.intent, ...(typeof tool.start_at === "string" && tool.start_at.trim() ? { startAtSeconds: resolveSeekSeconds(tool.start_at) } : {}) }).catch(e => {});
    #     }).catch(e => {});
    #   }
    # }
    # textBuffer += cleanChunk;
    # fullResponse += cleanChunk; // Since we stripped it from extractStageDirections, we must strip it here

    new_chunk_processing = """const chunkText = data.text;
                  const cleanChunk = toolExtractorRef.current.feed(chunkText);
                  const tools = toolExtractorRef.current.extractTools();
                  for (const tool of tools) {
                    if (tool.query || tool.mood || tool.activity || tool.genre || tool.intent === "similar" || tool.user_query) {
                      import("@/music/MusicService").then(({ musicService }) => {
                        musicService.processIntent({ type: "play", query: tool.query || tool.user_query, mood: tool.mood, energy: tool.energy, genre: tool.genre, activity: tool.activity, intent: tool.intent, ...(typeof tool.start_at === "string" && tool.start_at.trim() ? { startAtSeconds: resolveSeekSeconds(tool.start_at) } : {}) }).catch(e => {});
                      }).catch(e => {});
                    }
                  }
                  textBuffer += cleanChunk;
                  fullResponse += cleanChunk;"""
                  
    content = re.sub(
        r'const chunkText = data\.text;\s*textBuffer \+= chunkText;\s*fullResponse \+= chunkText;',
        new_chunk_processing,
        content
    )

    # 5. Remove the MUSIC TOOL INTERCEPTOR blocks
    content = re.sub(
        r'// MUSIC TOOL INTERCEPTOR: Prevent JSON blocks from being split by punctuation\n\s*if \(textBuffer\.includes\("\{"\) && !textBuffer\.includes\("\}"\)\) \{\n\s*continue; // Wait for the closing brace before processing further\n\s*\}\n\n\s*const toolMatch = textBuffer\.match\(/\\\{\\s\*"tool"\\s\*:\\s\*"play_music"/\);\n\s*if \(toolMatch\) \{.*?\n\s*\}\n\s*\}',
        '',
        content,
        flags=re.DOTALL
    )
    
    # 6. Same for newText chunk loop
    new_text_processing = """const newText = data.text;
                const cleanNewText = toolExtractorRef.current.feed(newText);
                const newTools = toolExtractorRef.current.extractTools();
                for (const tool of newTools) {
                  if (tool.query || tool.mood || tool.activity || tool.genre || tool.intent === "similar" || tool.user_query) {
                    import("@/music/MusicService").then(({ musicService }) => {
                      musicService.processIntent({ type: "play", query: tool.query || tool.user_query, mood: tool.mood, energy: tool.energy, genre: tool.genre, activity: tool.activity, intent: tool.intent, ...(typeof tool.start_at === "string" && tool.start_at.trim() ? { startAtSeconds: resolveSeekSeconds(tool.start_at) } : {}) }).catch(e => {});
                    }).catch(e => {});
                  }
                }
                currentBuffer += cleanNewText;
                completeResponse += cleanNewText;"""
                
    content = re.sub(
        r'const newText = data\.text;\s*currentBuffer \+= newText;\s*completeResponse \+= newText;',
        new_text_processing,
        content
    )

    content = re.sub(
        r'// MUSIC TOOL INTERCEPTOR: Hold buffer if JSON tool block is being assembled\n\s*if \(currentBuffer\.includes\("\{"\) && !currentBuffer\.includes\("\}"\)\) \{\n\s*continue; // Wait for closing brace before sentence extraction\n\s*\}\n\n\s*const toolStart = currentBuffer\.match\(/\\\{\\s\*"tool"\\s\*:\\s\*"play_music"/\);\n\s*if \(toolStart\) \{.*?\n\s*\}\n\s*\}',
        '',
        content,
        flags=re.DOTALL
    )

    # 7. Add toolExtractorRef.current.reset() on connection/start
    # E.g., when the fetch is initiated or before the loop
    # Let's find "toolExtractorRef.current.reset()" and add it where appropriate.
    # We can add it just before `let textBuffer = "";`
    content = re.sub(
        r'(let textBuffer = "";)',
        r'toolExtractorRef.current.reset();\n                  \1',
        content
    )
    content = re.sub(
        r'(let currentBuffer = "";)',
        r'toolExtractorRef.current.reset();\n                \1',
        content
    )

    # Write back
    with open(filepath, 'w') as f:
        f.write(content)

update_file('src/providers/sarvam/useSarvam.ts')
update_file('src/providers/openrouter/useProvider.ts')
