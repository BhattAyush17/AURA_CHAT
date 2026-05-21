# session_slang_memory.py

class SessionSlangMemory:
    def __init__(self):
        self.session_data = {}

    def track_slang(self, session_id: str, matched_terms: list, abbreviation_hits: list):
        if session_id not in self.session_data:
            self.session_data[session_id] = {
                "observed_user_slang": [],
                "frequency_map": {}
            }
        
        session = self.session_data[session_id]
        all_terms = matched_terms + abbreviation_hits
        
        for term in all_terms:
            if term not in session["observed_user_slang"]:
                session["observed_user_slang"].append(term)
            session["frequency_map"][term] = session["frequency_map"].get(term, 0) + 1

    def get_session_profile(self, session_id: str) -> dict:
        data = self.session_data.get(session_id, {"observed_user_slang": [], "frequency_map": {}})
        preferred_style = "neutral"
        if data["observed_user_slang"]:
            preferred_style = "profane_casual"
        return {
            "observed_user_slang": data["observed_user_slang"],
            "frequency_map": data["frequency_map"],
            "preferred_style": preferred_style
        }
