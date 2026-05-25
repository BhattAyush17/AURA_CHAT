# OpenRouter Pipeline Fixes

**Date**: 2026-05-19
**File**: `AURA_CHAT/src/hooks/useOpenRouter.ts`

## Issue Identified

There was a critical bug in the OpenRouter pipeline causing the assistant's generated response to be partially or completely lost:

1. **State closure issues**: The `words` state variable was being used directly in the `processTurn` closure (`const spokenText = words`). Due to React's stale state closure inside asynchronous callbacks, `words` consistently evaluated to the initial state value (`""` or `"AURA is perceiving..."`) instead of the newly updated completion string.
2. **Buffer Destruction (Slicing)**: The `fullText` variable was functioning purely as a text buffer for the sentence boundary regex parser (`SENTENCE_END.exec(fullText)`). To handle streaming properly, the parser slices `fullText` once a sentence is found and passed to the TTS queue (`fullText.slice(lastIndex)`). Since `setWords(fullText)` was called _after_ accumulating but _before_ slicing, it correctly flashed text to the UI, but it never preserved the _entire_ generated response.

### Consequences

- **Memory Disconnect**: Because `spokenText` was empty or static, `transcript_.addTurn(spokenText, false)` failed to store what the assistant actually said.
- **Lost Context**: Subsequent API calls via `messages` array did not contain the assistant's replies. AURA effectively suffered from short-term memory loss regarding her own responses.
- **UI Glitches**: If `setWords` flashed the entire string and then got sliced, the frontend text could appear jumpy or incomplete once generation finished.

## Resolution

A split-variable approach was introduced to separate **streaming accumulation** from **sentence extraction**:

1. **Introduced `completeResponse` variable**:
   - We now maintain an immutable continuous accumulator (`completeResponse += token`) across the lifetime of the stream.
   - We safely pass `completeResponse` to `setWords(completeResponse)` to continuously render the entire output on the UI without loss.

2. **Renamed `fullText` to `currentBuffer`**:
   - `currentBuffer` handles the sentence boundaries logic.
   - Tokens get added to `currentBuffer`. When a matching sentence boundary regex is executed, `currentBuffer` is sliced.
   - This fixes the destructive parsing and keeps the `completeResponse` intact.

3. **Fixed Transcript Updating & Success Verification**:
   - Changed: `const spokenText = words;` (which was causing the stale state bug).
   - Replaced with: `if (success && completeResponse)` ensuring that ONLY successfully parsed and completely generated API responses are appended to the application's conversation messages and the persistent canonical transcript.

### Relevant Code Changes

```diff
-    let fullText = "";
+    let currentBuffer = "";
+    let completeResponse = "";

-              fullText += token;
-              setWords(fullText);
+              currentBuffer += token;
+              completeResponse += token;
+              setWords(completeResponse);

-              while ((match = SENTENCE_END.exec(fullText)) !== null) {
+              while ((match = SENTENCE_END.exec(currentBuffer)) !== null) {
                 ...
-              if (lastIndex > 0) fullText = fullText.slice(lastIndex);
+              if (lastIndex > 0) currentBuffer = currentBuffer.slice(lastIndex);

-    const spokenText = words;
-    if (spokenText) {
-      setMessages((prev) => [...prev, { role: "assistant", content: spokenText }]);
-      transcript_.addTurn(spokenText, false);
-    }
+    if (success && completeResponse) {
+      setMessages((prev) => [...prev, { role: "assistant", content: completeResponse }]);
+      transcript_.addTurn(completeResponse, false);
+    }
```
