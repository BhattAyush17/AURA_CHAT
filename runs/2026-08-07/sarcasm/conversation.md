# Sarcasm — End-to-End Run

- Dataset: `sarcasm` · Model: deepseek/deepseek-chat · Started: 2026-08-07T02:20:20.927Z
- Estimated duration: 10 min · Turns: 3
- Interruptions: 0 · Repairs: 0 · Callbacks: 0 · Memory used: 0
- Reflection adaptations: 3 · Language switches: 0 · Register changes: 0
- Avg Executive Fidelity: 78% · Avg Humanity: 8.0 · Realism: 8.0
- Pipeline avg: 1647ms/turn · Production readiness: NOT READY

────────────────────
TURN 1
────────────────────
USER "Wow."
PERCEPTION confidence 0.92 | tags [sarcastic]
UNDERSTANDING move Continue | goal small-talk | implicit dissatisfied | expected follow-up | social [irony(0.80),user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP NEW
REFLECTION adapted: length delta: -2 words; thread continued naturally; move: Continue (0.85); expected: follow-up
LANGUAGE PURE_ENGLISH (conf 1.00, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Observe | initiative Observe | budget Short | conf High
PROMPT 261 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Not bad, right?"
EXECUTIVE FIDELITY 67% (lang ✓ | register ✓ | memory ✓ | strategy ✗ | initiative ✗ | budget ✓)
HUMAN SCORE 8.0/10 FEELS HUMAN [naturalness✓ flow✓ humor✗ confidence✓ presence✓]
PIPELINE 1141ms

────────────────────
TURN 2
────────────────────
USER "Amazing."
PERCEPTION confidence 0.92 | tags [sarcastic]
UNDERSTANDING move Answer | goal inform | implicit dissatisfied | expected follow-up | social [irony(0.80),user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP NEW
REFLECTION adapted: user followed up briefly; Tiny turn was proportionate; length delta: -1 words; thread continued naturally; move: Answer (0.76); expected: follow-up
LANGUAGE PURE_ENGLISH (conf 1.00, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Ask | initiative Ask | budget Tiny | conf High
PROMPT 258 tokens
SPEECH speed 0.95 | energy 0.50
LLM "What’s got you so impressed?"
EXECUTIVE FIDELITY 100% (lang ✓ | register ✓ | memory ✓ | strategy ✓ | initiative ✓ | budget ✓)
HUMAN SCORE 8.0/10 FEELS HUMAN [naturalness✓ flow✓ humor✗ confidence✓ presence✓]
PIPELINE 2633ms

────────────────────
TURN 3
────────────────────
USER "Exactly what I wanted."
PERCEPTION confidence 0.92 | tags [sarcastic]
UNDERSTANDING move Answer | goal inform | implicit dissatisfied | expected follow-up | social [irony(0.80),user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP ACQUAINTING
REFLECTION adapted: user followed up briefly; Tiny turn was proportionate; length delta: 0 words; thread continued naturally; move: Answer (0.76); expected: follow-up
LANGUAGE PURE_ENGLISH (conf 1.00, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Ask | initiative Ask | budget Tiny | conf High
PROMPT 252 tokens
SPEECH speed 0.95 | energy 0.50
LLM "Glad to hear it hit the spot!"
EXECUTIVE FIDELITY 67% (lang ✓ | register ✓ | memory ✓ | strategy ✗ | initiative ✗ | budget ✓)
HUMAN SCORE 8.0/10 FEELS HUMAN [naturalness✓ flow✓ humor✗ confidence✓ presence✓]
PIPELINE 1166ms
