# abbreviation_mapper.py
import re

ABBREVIATIONS = {
    "bc": "behenchod",
    "mc": "madarchod",
    "bsdk": "bhosdike",
    "stfu": "shut the fuck up",
    "wtf": "what the fuck",
    "gtfo": "get the fuck out",
    "lmao": "laughing my ass off",
    "lmfao": "laughing my fucking ass off",
    "kys": "kill yourself",
    "omfg": "oh my fucking god",
    "af": "as fuck",
    "ffs": "for fucks sake",
    "smh": "shaking my head",
    "mf": "motherfucker",
    "mfer": "motherfucker",
    "idc": "i dont care",
    "nvm": "nevermind",
    "bkl": "bhosdi ke lode",
    "mkc": "maa ki chut",
    "tmkb": "teri maa ka bhosda"
}

def map_abbreviations(text: str) -> str:
    words = text.split()
    expanded = []
    abbreviation_hits = []
    for word in words:
        clean = re.sub(r'[^a-zA-Z]', '', word).lower()
        if clean in ABBREVIATIONS:
            expanded.append(ABBREVIATIONS[clean])
            abbreviation_hits.append(clean)
        else:
            expanded.append(word)
    return " ".join(expanded), abbreviation_hits
