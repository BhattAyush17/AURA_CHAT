"""
AURA Single-Pass Batch Extractor
Processes each ideology chat file in ONE Gemini call.
Output: Compact JSON (~8KB) with keyword maps, exchanges, templates, signature.

Usage:
    python batch_extract.py              # Process all 6 chat files
    python batch_extract.py --file 1     # Process only ideology 1
"""

import os
import sys
import json
import re
from typing import Dict, Any, List
from dotenv import load_dotenv

load_dotenv(".env.local")


# ═══════════════════════════════════════════════════════════════════
# IDEOLOGY MAP
# ═══════════════════════════════════════════════════════════════════

IDEOLOGY_FILES = {
    "1": ("1_Chaotic_Male_Hostel.txt", "RAW_CHAOTIC_MALE_HOSTEL"),
    "2": ("2_GENZ_PLAYFUL_BOND.txt", "GENZ_PLAYFUL_BOND_DEEP_UNDERCURRENT"),
    "3": ("3_PLAYFUL_PROFESSIONAL_FRIENDSHIP_BAL.txt", "PLAYFUL_PROFESSIONAL_FRIENDSHIP_BALANCED"),
    "4": ("4_FORMAL_PROFESSIONAL_COLLABORATIVE.txt", "FORMAL_PROFESSIONAL_COLLABORATIVE"),
    "5": ("5_EMOTIONALLY_INTELLIGENT_DEEP_SUPPOR.txt", "EMOTIONALLY_INTELLIGENT_DEEP_SUPPORTIVE"),
    "6": ("6_MINIMAL_PHILOSOPHICAL_MALE_INTROSPE.txt", "MINIMAL_PHILOSOPHICAL_MALE_INTROSPECTIVE"),
}


# ═══════════════════════════════════════════════════════════════════
# EXTRACTION PROMPT (Single API call per file)
# ═══════════════════════════════════════════════════════════════════

EXTRACTION_PROMPT = """You are a behavioral pattern extractor for a conversational AI system.

INPUT: Raw chat log text from ideology: {ideology_name}
TASK: Single-pass extraction. Do not re-read input. Output JSON only.

STEP 1 — Build keyword map (frequency-based, no inference):
Count every word that appears 2+ times. Exclude stopwords: [the, a, an, is, it, in, on, of, to, and, or, but, I, you, he, she, we, they, this, that, hai, ka, ki, ke, ko, se, me, ye, wo, jo, ne].
Group into categories by co-occurrence pattern:
  - If word appears near money/payment words → "money"
  - If word appears near urgency words → "urgency"
  - If word appears with humor markers → "bonding"
  - If word appears near class/work/task words → "task"
  - If word appears with emotional words → "emotional"
  - Else → "general"
Keep top 15 words per category. Discard the rest.

STEP 2 — Extract 20 exchanges (input + response pairs):
An exchange = one speaker's continuous turn + the reply.
Skip exchanges under 3 words total.
For each exchange output only:
  {{ "in": "speaker A text", "out": "speaker B response", "act": "REQUEST|ASSERTION|JOKE|QUESTION|ALERT|AGREEMENT|AVOIDANCE", "tags": ["tag1","tag2"] }}

Pick the 20 MOST DIVERSE exchanges — cover all speech acts, all topics, all energy levels.

STEP 3 — Build 3 response templates per speech act:
From patterns seen in exchanges, not invented.
Format: {{ "act": "REQUEST", "templates": ["short_form", "delayed_form", "refusal_form"] }}

Cover at LEAST: REQUEST, ASSERTION, JOKE, QUESTION, ALERT, AGREEMENT

OUTPUT FORMAT (strict JSON, no prose, no markdown):
{{
  "ideology": "{ideology_name}",
  "keyword_map": {{
    "money": ["word1","word2"],
    "urgency": ["word1","word2"],
    "bonding": ["word1","word2"],
    "task": ["word1","word2"],
    "emotional": ["word1","word2"],
    "general": ["word1","word2"]
  }},
  "exchanges": [
    {{ "in": "...", "out": "...", "act": "REQUEST", "tags": ["tag1","tag2"] }}
  ],
  "templates": [
    {{ "act": "REQUEST", "templates": ["short_form", "delayed_form", "refusal_form"] }}
  ],
  "signature": {{
    "avg_response_words": 3,
    "implicit_percentage": 85,
    "dominant_act": "REQUEST"
  }}
}}

SIZE LIMIT: Output must be under 8KB. If exchanges exceed limit, keep only the 10 most distinct ones.

RAW CHAT LOG:
{chat_content}
"""


# ═══════════════════════════════════════════════════════════════════
# GEMINI CLIENT
# ═══════════════════════════════════════════════════════════════════

def get_client():
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("VITE_GEMINI_API_KEY")
    if not api_key:
        raise ValueError("No API key. Set GEMINI_API_KEY or VITE_GEMINI_API_KEY in .env.local")
    from google import genai
    return genai.Client(api_key=api_key)


# ═══════════════════════════════════════════════════════════════════
# EXTRACTION
# ═══════════════════════════════════════════════════════════════════

def read_chat_file(filepath: str, max_chars: int = 28000) -> str:
    """Read chat file, truncate if too large for context window."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Skip header lines (description/metadata at top of file)
    lines = content.split('\n')
    chat_lines = []
    started = False
    for line in lines:
        # Start capturing after we see the first "Speaker: text" pattern
        if re.match(r'^[A-Za-z_]+\s*:', line):
            started = True
        if started:
            chat_lines.append(line)
    
    content = '\n'.join(chat_lines)
    
    if len(content) > max_chars:
        print(f"   ⚠ Truncating from {len(content)} to {max_chars} chars")
        content = content[:max_chars]
    
    return content


def extract_ideology(client, ideology_id: str, chats_dir: str = "./Chats") -> Dict[str, Any]:
    """Extract behavioral data from one ideology chat file."""
    from google.genai import types
    filename, ideology_name = IDEOLOGY_FILES[ideology_id]
    filepath = os.path.join(chats_dir, filename)
    
    if not os.path.exists(filepath):
        print(f"   ❌ File not found: {filepath}")
        return None
    
    print(f"\n📄 [{ideology_id}] {ideology_name}")
    print(f"   Source: {filename}")
    
    chat_content = read_chat_file(filepath)
    print(f"   Chat size: {len(chat_content)} chars")
    
    prompt = EXTRACTION_PROMPT.format(
        ideology_name=ideology_name,
        chat_content=chat_content,
    )
    
    print(f"   🔄 Calling Gemini (single pass)...")
    
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=8192,
                response_mime_type="application/json",
                safety_settings=[
                    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
                    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
                ]
            ),
            contents=prompt
        )
        result = json.loads(response.text)

        
        # Validate structure
        required_keys = ["ideology", "keyword_map", "exchanges", "templates", "signature"]
        for key in required_keys:
            if key not in result:
                print(f"   ⚠ Missing key: {key}")
                result[key] = {} if key in ["keyword_map", "signature"] else []
        
        ex_count = len(result.get("exchanges", []))
        tmpl_count = len(result.get("templates", []))
        kw_count = sum(len(v) for v in result.get("keyword_map", {}).values())
        
        print(f"   ✅ Extracted: {ex_count} exchanges, {tmpl_count} template sets, {kw_count} keywords")
        
        return result
        
    except json.JSONDecodeError as e:
        print(f"   ❌ JSON parse error: {e}")
        print(f"   Raw response: {response.text[:200]}...")
        return None
    except Exception as e:
        print(f"   ❌ API error: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    output_dir = "./extracted_data"
    os.makedirs(output_dir, exist_ok=True)
    
    client = get_client()
    
    # Determine which ideologies to process
    if len(sys.argv) > 2 and sys.argv[1] == "--file":
        ids_to_process = [sys.argv[2]]
    else:
        ids_to_process = list(IDEOLOGY_FILES.keys())
    
    all_results = {}
    
    for ideology_id in ids_to_process:
        if ideology_id not in IDEOLOGY_FILES:
            print(f"⚠ Unknown ideology ID: {ideology_id}")
            continue
        
        result = extract_ideology(client, ideology_id)

        
        if result:
            ideology_name = IDEOLOGY_FILES[ideology_id][1]
            all_results[ideology_name] = result
            
            # Save individual file
            out_path = os.path.join(output_dir, f"{ideology_name}.json")
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"   💾 Saved → {out_path}")
    
    # Save combined keyword maps (for runtime loading)
    keyword_maps = {}
    for ideology_name, data in all_results.items():
        keyword_maps[ideology_name] = data.get("keyword_map", {})
    
    maps_path = os.path.join(output_dir, "_keyword_maps.json")
    with open(maps_path, 'w', encoding='utf-8') as f:
        json.dump(keyword_maps, f, indent=2, ensure_ascii=False)
    print(f"\n📦 Combined keyword maps → {maps_path}")
    
    # Save combined exchanges (for ChromaDB ingestion)
    all_exchanges = []
    for ideology_name, data in all_results.items():
        for idx, ex in enumerate(data.get("exchanges", [])):
            ex["ideology"] = ideology_name
            ex["id"] = f"{ideology_name}_{idx:03d}"
            all_exchanges.append(ex)
    
    exchanges_path = os.path.join(output_dir, "_all_exchanges.json")
    with open(exchanges_path, 'w', encoding='utf-8') as f:
        json.dump(all_exchanges, f, indent=2, ensure_ascii=False)
    print(f"📦 All exchanges ({len(all_exchanges)}) → {exchanges_path}")
    
    # Save combined templates
    all_templates = {}
    for ideology_name, data in all_results.items():
        all_templates[ideology_name] = data.get("templates", [])
    
    templates_path = os.path.join(output_dir, "_all_templates.json")
    with open(templates_path, 'w', encoding='utf-8') as f:
        json.dump(all_templates, f, indent=2, ensure_ascii=False)
    print(f"📦 All templates → {templates_path}")
    
    print(f"\n{'='*60}")
    print(f"🎉 Batch extraction complete! {len(all_results)}/{len(ids_to_process)} ideologies processed.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
