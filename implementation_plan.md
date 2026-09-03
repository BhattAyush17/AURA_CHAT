# Goal Description

Implement the first layer of AURA Music Intelligence by establishing a clean, production-ready frontend provider selection and Google OAuth connection state. This phase focuses entirely on authentication, provider UI, and connection state management (disconnected, connecting, authorizing, connected, error, revoked), without building the actual music recommendation or playback systems yet.

## User Review Required

> [!IMPORTANT]
> **YouTube Music API Reality Check**
> Google does **not** provide an official, public API specifically for YouTube Music. Standard Google OAuth with `youtube` scopes allows access to the YouTube Data API v3 (videos, standard playlists), but it does not provide access to YouTube Music-specific features (like user's YouTube Music history, radio stations, or direct playback control) using OAuth tokens.
>
> We will still build the UI to offer "YouTube" and "YouTube Music" as distinct provider choices to preserve the AURA user experience intention, but technically they will both rely on the same underlying Google OAuth identity and standard YouTube API scopes for now.

## Open Questions

> [!WARNING]
> The existing `GoogleIdentityService.ts` and `GoogleAuthProvider.ts` both implement popup-based OAuth Implicit Flow (returning `access_token` directly to the browser). The Implicit Flow does _not_ provide a `refresh_token`. The prompt mandates: "Do NOT place Google OAuth client secrets or refresh tokens in VITE\_*... Do not expose refresh tokens to browser JavaScript." Since we are using Implicit Flow entirely in the frontend, there are no refresh tokens or client secrets to expose. Are you comfortable keeping the frontend popup Implicit Flow for this phase, or do you want me to build a backend Authorization Code Flow with PKCE in the `backend/` directory to securely handle refresh tokens?
> *For this plan, I will proceed with extending the existing frontend popup flow since it adheres to the rule of not exposing secrets, but please confirm if a backend flow is preferred.\*

## Proposed Changes

### Provider Abstraction & Types

#### [NEW] `src/music/types/provider.ts`

Define the core provider model and connection states:

```typescript
export type MusicProviderId = "youtube" | "youtube_music";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authorizing"
  | "connected"
  | "error"
  | "revoked";

export interface MusicProviderAdapter {
  id: MusicProviderId;
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  getAccountEmail(): string | null;
}
```

### Authentication Layer

#### [MODIFY] `src/auth/GoogleIdentityService.ts`

- Audit and refine to ensure it supports the specific scopes needed (`youtube.readonly`).
- Ensure it cleanly separates AURA app auth from Music Intelligence Google Auth.
- Expose connection state securely and ensure token persistence uses safe storage mechanisms.

#### [NEW] `src/music/providers/GoogleMusicProvider.ts`

- Implement `MusicProviderAdapter`.
- Wrap `GoogleIdentityService` to manage the transition through the exact states: `disconnected` -> `connecting` -> `authorizing` -> `connected` (or `error`).
- Handle provider selection (differentiating YouTube vs YouTube Music in state, even if they share the OAuth backend).

### UI Updates

#### [MODIFY] `src/sense/SensePanel.tsx`

Update the Music Intelligence UI flow to explicitly show:

- Provider selection screen (YouTube vs YouTube Music).
- Connection states (Not connected, Connecting..., Waiting for Google authorization..., CONNECTED ✓, Error, Revoked).
- The connected Google account email.
- A functional `[ DISCONNECT ]` button.
- Remove claims of full music control; only claim "CONNECTED".

## Verification Plan

### Automated Tests

- Run `npm run build` to ensure the frontend builds successfully.
- Run typecheck and linting to ensure no regressions.

### Manual Verification

1. **YouTube Flow**: Open Music Intelligence -> choose YouTube -> Google OAuth popup -> approve -> return -> State shows `CONNECTED` with email.
2. **YouTube Music Flow**: Choose YouTube Music -> Google OAuth popup -> approve -> return -> State shows `CONNECTED` with email.
3. **Denial**: Deny permission -> State returns to disconnected with readable error.
4. **Refresh**: Reload the page -> Connection state restores correctly.
5. **Disconnect**: Click disconnect -> Clears state and returns to provider selection.
6. **Security Check**: Verify `localStorage` and `sessionStorage` do not contain client secrets or refresh tokens. Verify `VITE_` variables do not contain secrets.
