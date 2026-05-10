export type PersonalityMode =
  | "adaptive"
  | "chaotic"
  | "genz"
  | "balanced"
  | "supportive"
  | "philosophical"
  | "caring"
  | "professional"
  | "latenight";

interface PersonalitySelectorProps {
  value: PersonalityMode;
  onChange: (p: PersonalityMode) => void;
  disabled?: boolean;
}

const personalities: { id: PersonalityMode; label: string; hint: string }[] = [
  { id: "adaptive", label: "Adaptive", hint: "auto · dynamic" },
  { id: "chaotic", label: "Chaotic", hint: "raw · unfiltered" },
  { id: "genz", label: "GenZ", hint: "banter · playful" },
  { id: "balanced", label: "Balanced", hint: "warm · practical" },
  { id: "supportive", label: "Supportive", hint: "deep · empathetic" },
  { id: "caring", label: "Caring", hint: "tender · intimate" },
  { id: "latenight", label: "Late Night", hint: "3am · raw" },
  { id: "philosophical", label: "Philosophical", hint: "minimal · introspective" },
  { id: "professional", label: "Professional", hint: "structured · polite" },
];

export function PersonalitySelector({ value, onChange, disabled }: PersonalitySelectorProps) {
  return (
    <div className="flex w-full overflow-x-auto rounded-[2rem] border border-border bg-background p-1 hide-scrollbar">
      {personalities.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            disabled={disabled}
            onClick={() => onChange(p.id)}
            className={`flex-1 whitespace-nowrap rounded-[2rem] px-4 py-3 text-[10px] uppercase tracking-[0.15em] transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 min-w-min ${
              active
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="font-medium">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
