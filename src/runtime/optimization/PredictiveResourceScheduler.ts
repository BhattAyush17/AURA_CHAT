// src/runtime/optimization/PredictiveResourceScheduler.ts
import { RuntimeDecision } from "../contracts/ExecutionContracts";

export interface ResourceReservation {
  audioBuffers: number;
  memoryTimeoutMs: number;
  workerCapacity: "high" | "normal" | "low";
}

export class PredictiveResourceScheduler {
  private static instance: PredictiveResourceScheduler;

  private constructor() {}

  public static getInstance(): PredictiveResourceScheduler {
    if (!PredictiveResourceScheduler.instance) {
      PredictiveResourceScheduler.instance = new PredictiveResourceScheduler();
    }
    return PredictiveResourceScheduler.instance;
  }

  public predictResources(decision: RuntimeDecision, expectedLength: number): ResourceReservation {
    const reservation: ResourceReservation = {
      audioBuffers: 50,
      memoryTimeoutMs: 500,
      workerCapacity: "normal"
    };

    if (decision.conversationMomentum === "Fast") {
      reservation.audioBuffers = 30; // Short bursts
      reservation.memoryTimeoutMs = 200; // Cut memory short to keep speed
    } else if (decision.conversationMomentum === "Deep") {
      reservation.audioBuffers = 100; // Long streaming
      reservation.memoryTimeoutMs = 800; // Allow deeper memory search
      reservation.workerCapacity = "high";
    }

    if (expectedLength > 500) {
      reservation.audioBuffers += 50;
    }

    return reservation;
  }
}
