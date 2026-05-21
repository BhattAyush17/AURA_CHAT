# speech_noise_cleaner.py
import re

def clean_speech_noise(text: str) -> str:
    # Remove filler words from ASR distortions
    fillers = [r'\bum\b', r'\buh\b', r'\bah\b', r'\blike\b', r'\byou know\b']
    for filler in fillers:
        text = re.sub(filler, '', text, flags=re.IGNORECASE)
    # Remove random trailing/leading garbage
    text = text.strip('*-~ ')
    text = re.sub(r'\s+', ' ', text)
    return text
