/**
 * AURA Sense System — Public API
 *
 * Only SenseManager is exported for ATF consumption.
 * Individual Senses are internal implementation details.
 */
export { SenseManager } from "./SenseManager/SenseManager";
export type { SenseEvidenceV1, SenseHealth, SenseStatusCode, AuraSense } from "./SenseManager/types";
