class AttentionFocus:
    def __init__(self):
        self.primary_target = "Self" # Self, User, Environment, specific topic
        self.intensity = 0.5 # 0.0 diffuse, 1.0 hyper-focused
        
    def drift(self, env_fields, presence):
        # Attention naturally drifts based on environmental urgency and internal tension
        env_urgency = env_fields.get("urgency").intensity if env_fields.get("urgency") else 0.0
        internal_tension = presence.pressures.get("attention", 0.0)
        
        if env_urgency > 0.6:
            self.primary_target = "Environment"
            self.intensity = min(1.0, self.intensity + 0.1)
        elif internal_tension > 0.6:
            self.primary_target = "Internal Tension"
            self.intensity = min(1.0, self.intensity + 0.1)
        else:
            # Diffuse attention when quiet
            self.intensity = max(0.2, self.intensity - 0.05)
            if self.intensity < 0.4:
                self.primary_target = "Wandering"
