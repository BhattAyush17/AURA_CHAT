const ACTION_COOLDOWN = 10000;
let lastActionTime = 0;
function parseSegments(text) {
  const segments = [];
  const noEmojis = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  const regex = /\*([^*]+)\*|\(([^)]+)\)|\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(noEmojis)) !== null) {
    if (match.index > lastIndex) {
      const normalText = noEmojis.substring(lastIndex, match.index).trim();
      if (normalText) {
        segments.push({ text: normalText, style: "normal" });
      }
    }
    const actionText = (match[1] || match[2] || match[3] || "").trim();
    const actionLower = actionText.toLowerCase();
    const now = Date.now();
    const canAct = (now - lastActionTime) > ACTION_COOLDOWN;
    let style = "aside";
    if (actionLower.includes("laugh") || actionLower.includes("chuckle") || actionLower.includes("giggle")) style = "laugh";
    else if (actionLower.includes("sigh")) style = "sigh";
    else if (match[2] || actionLower.includes("thinking")) style = "thinking";
    else if (match[3] || actionLower.includes("whisper")) style = "whisper";
    else if (actionLower.includes("serious") || actionLower.includes("heavy")) style = "serious";
    else if (actionLower.includes("excited") || actionLower.includes("light")) style = "excited";
    if (style === "laugh" || style === "sigh") {
      if (canAct) {
        segments.push({ text: "", style });
        lastActionTime = now;
      }
    } else {
      segments.push({ text: actionText, style });
    }
    lastIndex = regex.lastIndex;
  }
  const trailingText = noEmojis.substring(lastIndex).trim();
  if (trailingText) {
    segments.push({ text: trailingText, style: "normal" });
  }
  return segments;
}

console.log(parseSegments("*leans closer* You know... *laughs* That's ridiculous. [whisper] Don't tell anyone."));
