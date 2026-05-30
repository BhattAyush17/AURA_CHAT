import { useEffect, useRef } from 'react';

// Base thresholds
const BASE_THRESHOLD = 0.015; 
// When TTS is active, speaker bleed happens. Raise the threshold to require a louder human interruption.
const ACTIVE_TTS_THRESHOLD = 0.035; 
const SUSTAINED_FRAMES = 3; 

export function useBargeIn(
    analyserRef: React.MutableRefObject<AnalyserNode | null>,
    isAuraSpeaking: boolean,
    onInterrupt: () => void,
    sentenceQueue?: React.MutableRefObject<string[]>
) {
    const loudFrameCount = useRef(0);
    const speakingStartTime = useRef<number>(0);

    // Track exactly when AURA starts speaking to manage the grace period
    useEffect(() => {
        if (isAuraSpeaking) {
            speakingStartTime.current = Date.now();
        }
    }, [isAuraSpeaking]);

    useEffect(() => {
        let animationFrameId: number;
        const bufferLength = analyserRef.current?.frequencyBinCount || 0;
        const dataArray = new Float32Array(bufferLength);

        const checkAudioLevel = () => {
            if (!analyserRef.current) return;
            
            analyserRef.current.getFloatTimeDomainData(dataArray);
            
            let sumSquares = 0;
            for (let i = 0; i < bufferLength; i++) {
                sumSquares += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sumSquares / bufferLength);

            // 1. The Grace Period: Ignore all mic input for the first 400ms of TTS playback.
            // This prevents the initial mechanical "pop" of the speaker activating from triggering a false barge-in.
            const isGracePeriod = isAuraSpeaking && (Date.now() - speakingStartTime.current < 400);

            // 2. Dynamic Thresholding: Use a higher threshold if AURA is currently making noise
            const currentThreshold = isAuraSpeaking ? ACTIVE_TTS_THRESHOLD : BASE_THRESHOLD;

            if (isAuraSpeaking && !isGracePeriod && rms > currentThreshold) {
                loudFrameCount.current += 1;
                
                if (loudFrameCount.current >= SUSTAINED_FRAMES) {
                    if (typeof window !== "undefined" && window.speechSynthesis) {
                        window.speechSynthesis.cancel();
                    }
                    if (sentenceQueue) {
                        sentenceQueue.current = [];
                    }
                    loudFrameCount.current = 0;
                    onInterrupt();
                }
            } else {
                loudFrameCount.current = 0;
            }

            animationFrameId = requestAnimationFrame(checkAudioLevel);
        };

        if (analyserRef.current) {
            checkAudioLevel();
        }

        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, [isAuraSpeaking, sentenceQueue, onInterrupt, analyserRef]);
}
