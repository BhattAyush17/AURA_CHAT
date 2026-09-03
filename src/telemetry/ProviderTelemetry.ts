/**
 * ProviderTelemetry — thin lifecycle helpers over the runtime telemetry store
 * so the provider pipelines (Gemini Live / OpenRouter / Sarvam) can record
 * physical provider calls with minimum boilerplate.
 */

import type { CallKind, CallStatus, ProviderCall, ProviderName, TokenUsage } from "./types";
import { estimateTokenUsage } from "./tokenEstimate";

export interface BeginProviderCallOptions {
  provider: ProviderName;
  model: string;
  kind?: CallKind;
  audio?: boolean;
  requestId?: string;
  turnId?: string;
}

export interface EndProviderCallOptions {
  status?: CallStatus;
  ttftMs?: number;
  failureCode?: string;
  failureDetail?: string;
  /** Provider-reported token usage (OpenRouter usage object, Gemini usageMetadata). */
  usage?: Partial<TokenUsage>;
  /** Fallback heuristics used only when usage is missing; labeled ESTIMATED. */
  inputText?: string | null;
  outputText?: string | null;
}

/**
 * Begin a physical provider call. Returns callId. If no request is active it
 * implicitly opens a new request (request stats stay honest either way).
 */
export function beginProviderCall(
  store: {
    beginProviderCall(o: BeginProviderCallOptions): string;
  },
  opts: BeginProviderCallOptions,
): string {
  return store.beginProviderCall(opts);
}

/**
 * End a provider call. If no usage was reported and output text is available,
 * records an ESTIMATED usage so the panel can still show numbers — clearly
 * labeled estimated, never fabricated.
 */
export function endProviderCall(
  store: {
    endProviderCall(
      callId: string,
      r: {
        status: CallStatus;
        ttftMs?: number;
        usage?: Partial<TokenUsage>;
        failureCode?: string;
        failureDetail?: string;
      },
    ): void;
    getSnapshot(): { providerCalls: ProviderCall[] };
  },
  callId: string,
  opts: EndProviderCallOptions,
): void {
  let usage: Partial<TokenUsage> | undefined = opts.usage;
  if ((!usage || (usage.inputTokens == null && usage.outputTokens == null)) && opts.outputText) {
    usage = estimateTokenUsage(opts.inputText, opts.outputText);
  }
  store.endProviderCall(callId, {
    status: opts.status ?? "success",
    ttftMs: opts.ttftMs,
    usage,
    failureCode: opts.failureCode,
    failureDetail: opts.failureDetail,
  });
}
