# Group Conversation — End-to-End Run

- Dataset: `group-conversation` · Model: deepseek/deepseek-chat · Started: 2026-08-07T02:19:14.732Z
- Estimated duration: 14 min · Turns: 3
- Interruptions: 0 · Repairs: 0 · Callbacks: 0 · Memory used: 0
- Reflection adaptations: 3 · Language switches: 0 · Register changes: 0
- Avg Executive Fidelity: 89% · Avg Humanity: 10.0 · Realism: 10.0
- Pipeline avg: 2259ms/turn · Production readiness: READY

────────────────────
TURN 1
────────────────────
USER "Guys, ek idea hai."
PERCEPTION confidence 0.92 | tags [group]
UNDERSTANDING move Answer | goal inform | implicit none | expected follow-up | social [user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP NEW
REFLECTION adapted: length delta: +1 words; thread continued naturally; move: Answer (0.95); expected: follow-up
LANGUAGE HINGLISH (conf 0.70, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Observe | initiative Observe | budget Short | conf High
PROMPT 289 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Acha batao, sunte hain."
EXECUTIVE FIDELITY 100% (lang ✓ | register ✓ | memory ✓ | strategy ✓ | initiative ✓ | budget ✓)
HUMAN SCORE 10.0/10 FEELS HUMAN [naturalness✓ flow✓ confidence✓ presence✓]
PIPELINE 1801ms

────────────────────
TURN 2
────────────────────
USER "Wait, sabki opinion sunte hain."
PERCEPTION confidence 0.92 | tags [group]
UNDERSTANDING move Wait | goal think-aloud | implicit none | expected silence | social [hesitation(0.75),user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP NEW
REFLECTION adapted: length delta: -5 words; thread continued naturally; move: Wait (0.95); expected: silence
LANGUAGE HINGLISH (conf 0.48, stab 0.50)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Listen | initiative Wait | budget Short | conf High
PROMPT 280 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Theek hai, sabki baat samajhna important hai."
EXECUTIVE FIDELITY 83% (lang ✓ | register ✓ | memory ✓ | strategy ✓ | initiative ✗ | budget ✓)
HUMAN SCORE 10.0/10 FEELS HUMAN [naturalness✓ flow✓ confidence✓ presence✓]
PIPELINE 1837ms

────────────────────
TURN 3
────────────────────
USER "Final decision?"
PERCEPTION confidence 0.92 | tags [group]
UNDERSTANDING move Ask | goal seek-information | implicit none | expected information | social [user-confidence(0.70)]
SWM none
MEMORY policy Ignore | retrieved 0 | injected 0 | referenced YES
RELATIONSHIP ACQUAINTING
REFLECTION adapted: length delta: 0 words; thread continued naturally; move: Ask (0.95); expected: information
LANGUAGE HINGLISH (conf 0.47, stab 0.33)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Answer | initiative Continue | budget Short | conf High
PROMPT 288 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Haan, ab sabki baat sun li hai toh decision le lete hain."
EXECUTIVE FIDELITY 83% (lang ✓ | register ✓ | memory ✓ | strategy ✗ | initiative ✓ | budget ✓)
HUMAN SCORE 10.0/10 FEELS HUMAN [naturalness✓ flow✓ confidence✓ presence✓]
PIPELINE 3139ms
