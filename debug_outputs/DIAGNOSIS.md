# Diagnosis

## Symptom

The `tsc --noEmit` build step encounters 12 TypeScript errors across 6 files, preventing a clean type-check.

## Investigation

The errors fall into three specific categories:

1. **Mismatched Argument Arity (Phase F.3 regression)**: In `useProvider.ts` and `useSarvam.ts`, `processTurn` was updated to remove the `audioContextXML` argument, changing its expected argument count to 3-4. However, internal recursive or handler calls to `processTurn` within those files are still passing 5 arguments.
2. **Missing `IntegrationTelemetry`**: Four validation scripts (`ExecutionValidator.ts`, `LatencyValidator.ts`, `PerformanceValidator.ts`, `PredictionValidator.ts`) are attempting to import `IntegrationTelemetry` from a non-existent `../integration/` directory.
3. **Legacy Undeclared Variables**: `useSarvam.ts` contains references to `ExecutionPlan`, `RegisterState`, and `wasInterrupted`, which were either removed or never existed, and property access errors for `behavior` on `ProviderExecutionDirective` in `useProvider.ts`.

## Root Cause

- **Phase F.3 Cleanup Gaps**: The removal of `audioContextXML` from provider contracts was incomplete at the call-site level inside the provider hooks themselves.
- **Legacy Debt**: The Validation directory and specific state types inside `useSarvam` and `useProvider` are accumulating unmaintained legacy references that Vite previously ignored due to isolated compilation, but `tsc` catches.
