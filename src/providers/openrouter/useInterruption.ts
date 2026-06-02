import { useEffect, useRef } from 'react';

// Base thresholds
const BASE_THRESHOLD = 0.04; 
// When TTS is active, speaker bleed happens. Raise the threshold to require a louder human interruption.
const ACTIVE_TTS_THRESHOLD = 0.15; 
const SUSTAINED_FRAMES = 15; 

export function useBargeIn(
    analyserRef: React.MutableRefObject<AnalyserNode | null>,
    isSpeakingRef: React.MutableRefObject<boolean>,
    onInterrupt: () => void,
    sentenceQueue?: React.MutableRefObject<string[]>,
    isInInterjectionWindow?: () => boolean
) {
    const loudFrameCount = useRef(0);
    const speakingStartTime = useRef<number>(0);
    const wasSpeakingRef = useRef<boolean>(false);

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

            const currentlySpeaking = isSpeakingRef.current;
            
            // Track exactly when AURA starts speaking EACH SENTENCE to manage the grace period
            if (currentlySpeaking && !wasSpeakingRef.current) {
                speakingStartTime.current = Date.now();
            }
            wasSpeakingRef.current = currentlySpeaking;

            // 1. The Grace Period: Ignore all mic input for the first 400ms of each TTS playback chunk.
            // This prevents the initial mechanical "pop" of the speaker activating from triggering a false barge-in.
            const isGracePeriod = currentlySpeaking && (Date.now() - speakingStartTime.current < 400);

            // 2. Dynamic Thresholding: Use a higher threshold if AURA is currently making noise
            // If we are in an interjection window (pause), AURA is silent, so we can use the base threshold
            const interjection = isInInterjectionWindow ? isInInterjectionWindow() : false;
            const currentThreshold = (currentlySpeaking && !interjection) ? ACTIVE_TTS_THRESHOLD : BASE_THRESHOLD;

            const shouldListen = currentlySpeaking || interjection;

            if (shouldListen && !isGracePeriod && rms > currentThreshold) {
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
    }, [isSpeakingRef, sentenceQueue, onInterrupt, analyserRef, isInInterjectionWindow]);
}
