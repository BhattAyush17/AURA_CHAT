# Patch Plan

## Proposed Changes

1. **Fix `processTurn` call sites**:
   - `src/providers/openrouter/useProvider.ts`: Locate internal `processTurn` calls passing 5 arguments and remove the last argument (`audioContextXML`).
   - `src/providers/sarvam/useSarvam.ts`: Similar to above, remove the redundant 5th argument from `processTurn` calls.
2. **Fix `ProviderExecutionDirective` errors**:
   - Check `src/providers/openrouter/useProvider.ts` for `.behavior` accesses and either remove them or update to the correct property (likely `.action` or `.decision`).
3. **Fix missing dependencies in Validators**:
   - Review `src/runtime/validation/*.ts`. If `IntegrationTelemetry` is genuinely gone and these validators are unused, comment them out or remove the import. If they are used, point to the correct telemetry class.
4. **Fix missing typings in `useSarvam.ts`**:
   - Remove or replace `wasInterrupted`, `ExecutionPlan`, and `RegisterState` references with valid state references.

## Risk Assessment

- **Scope**: Narrow. Only impacts specific TS compilation errors.
- **Risk**: Low. Fixing call-site arguments and dead code imports will not affect runtime since Vite previously ignored these type errors and the runtime still functioned.
- **Savepoint recommendation**: No branching required for these basic type fixes.
