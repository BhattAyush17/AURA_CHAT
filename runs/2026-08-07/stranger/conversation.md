# Stranger — End-to-End Run

- Dataset: `stranger` · Model: deepseek/deepseek-chat · Started: 2026-08-07T02:20:51.103Z
- Estimated duration: 8 min · Turns: 3
- Interruptions: 0 · Repairs: 0 · Callbacks: 0 · Memory used: 0
- Reflection adaptations: 3 · Language switches: 0 · Register changes: 0
- Avg Executive Fidelity: 78% · Avg Humanity: 9.2 · Realism: 9.2
- Pipeline avg: 2824ms/turn · Production readiness: NOT READY

────────────────────
TURN 1
────────────────────
USER "Hi."
PERCEPTION confidence 0.92 | tags [casual]
UNDERSTANDING move Continue | goal small-talk | implicit none | expected follow-up | social [user-confidence(0.70)]
SWM ritual-greeting
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP NEW
REFLECTION adapted: length delta: -3 words; thread continued naturally; move: Continue (0.95); expected: follow-up
LANGUAGE PURE_ENGLISH (conf 1.00, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Answer | initiative Continue | budget Short | conf High
PROMPT 252 tokens
SPEECH speed 1.00 | energy 0.50 | thinking "I want to understand something first…"
LLM "Hello! How can I help you today?"
EXECUTIVE FIDELITY 67% (lang ✓ | register ✗ | memory ✓ | strategy ✓ | initiative ✗ | budget ✓)
HUMAN SCORE 10.0/10 FEELS HUMAN [naturalness✓ flow✓ confidence✓ presence✓]
PIPELINE 3248ms

────────────────────
TURN 2
────────────────────
USER "Is this seat free?"
PERCEPTION confidence 0.92 | tags [casual]
UNDERSTANDING move Ask | goal seek-information | implicit none | expected information | social [user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP NEW
REFLECTION adapted: length delta: -5 words; thread continued naturally; move: Ask (0.95); expected: information
LANGUAGE PURE_ENGLISH (conf 1.00, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Answer | initiative Continue | budget Short | conf High
PROMPT 257 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Yes, it's free. Feel free to sit here."
EXECUTIVE FIDELITY 83% (lang ✓ | register ✓ | memory ✓ | strategy ✗ | initiative ✓ | budget ✓)
HUMAN SCORE 7.5/10 FEELS HUMAN [naturalness✗ flow✓ confidence✓ presence✓]
PIPELINE 1458ms

────────────────────
TURN 3
────────────────────
USER "Nice meeting you."
PERCEPTION confidence 0.92 | tags [politeness]
UNDERSTANDING move Answer | goal inform | implicit none | expected follow-up | social [user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP ACQUAINTING
REFLECTION adapted: length delta: 0 words; thread continued naturally; move: Answer (0.95); expected: follow-up
LANGUAGE PURE_ENGLISH (conf 1.00, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Observe | initiative Observe | budget Short | conf High
PROMPT 265 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Likewise! Enjoy your time here."
EXECUTIVE FIDELITY 83% (lang ✓ | register ✓ | memory ✓ | strategy ✗ | initiative ✓ | budget ✓)
HUMAN SCORE 10.0/10 FEELS HUMAN [naturalness✓ flow✓ confidence✓ presence✓]
PIPELINE 3767ms
