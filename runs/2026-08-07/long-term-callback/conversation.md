# Long-Term Callback — End-to-End Run

- Dataset: `long-term-callback` · Model: deepseek/deepseek-chat · Started: 2026-08-07T02:19:27.363Z
- Estimated duration: 12 min · Turns: 3
- Interruptions: 0 · Repairs: 0 · Callbacks: 3 · Memory used: 3
- Reflection adaptations: 3 · Language switches: 0 · Register changes: 0
- Avg Executive Fidelity: 61% · Avg Humanity: 8.0 · Realism: 8.0
- Pipeline avg: 1977ms/turn · Production readiness: NOT READY

────────────────────
TURN 1
────────────────────
USER "Yaad hai loan wala scene?"
PERCEPTION confidence 0.92 | tags [callback]
UNDERSTANDING move Ask | goal seek-information | implicit none | expected information | social [user-confidence(0.70)]
SWM none
MEMORY policy Required | retrieved 1 | injected 1 | referenced NO
RELATIONSHIP NEW
REFLECTION adapted: length delta: -4 words; thread continued naturally; move: Ask (0.95); expected: information
LANGUAGE ENGLISH_WITH_HINDI (conf 0.67, stab 1.00)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Answer | initiative Continue | budget Short | conf High
PROMPT 308 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Haan yaad hai. Tension tha na uss time par?"
EXECUTIVE FIDELITY 50% (lang ✓ | register ✓ | memory ✗ | strategy ✗ | initiative ✗ | budget ✓)
HUMAN SCORE 8.0/10 FEELS HUMAN [naturalness✓ flow✓ callbacks✗ confidence✓ presence✓]
PIPELINE 2046ms

────────────────────
TURN 2
────────────────────
USER "Aaj finally repay kar diya."
PERCEPTION confidence 0.92 | tags [callback,excitement]
UNDERSTANDING move Reflect | goal share-excitement | implicit none | expected agreement | social [excitement(0.75),user-confidence(0.70)]
SWM none
MEMORY policy Required | retrieved 1 | injected 1 | referenced NO
RELATIONSHIP NEW
REFLECTION adapted: length delta: -7 words; thread continued naturally; move: Reflect (0.85); expected: agreement
LANGUAGE ENGLISH_WITH_HINDI (conf 0.48, stab 0.50)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Encourage | initiative Continue | budget Short | conf High
PROMPT 308 tokens
SPEECH speed 1.00 | energy 0.70
LLM "Wah! Badhiya yaar. Ab toh full relief hoga na?"
EXECUTIVE FIDELITY 50% (lang ✓ | register ✓ | memory ✗ | strategy ✗ | initiative ✗ | budget ✓)
HUMAN SCORE 8.0/10 FEELS HUMAN [naturalness✓ flow✓ callbacks✗ confidence✓ presence✓]
PIPELINE 1782ms

────────────────────
TURN 3
────────────────────
USER "Ab khush?"
PERCEPTION confidence 0.92 | tags [callback]
UNDERSTANDING move Ask | goal seek-information | implicit none | expected information | social [user-confidence(0.70)]
SWM none
MEMORY policy Required | retrieved 1 | injected 1 | referenced NO
RELATIONSHIP ACQUAINTING
REFLECTION adapted: length delta: 0 words; thread continued naturally; move: Ask (0.95); expected: information
LANGUAGE ENGLISH_WITH_HINDI (conf 0.47, stab 0.33)
REGISTER NEUTRAL (conf 0.00)
EXECUTIVE strategy Answer | initiative Continue | budget Short | conf High
PROMPT 308 tokens
SPEECH speed 1.00 | energy 0.50
LLM "Bilkul! Aise hi celebrate karo, masti karo thodi. 😊"
EXECUTIVE FIDELITY 83% (lang ✓ | register ✓ | memory ✗ | strategy ✓ | initiative ✓ | budget ✓)
HUMAN SCORE 8.0/10 FEELS HUMAN [naturalness✓ flow✓ callbacks✗ confidence✓ presence✓]
PIPELINE 2103ms
