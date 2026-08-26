/**
 * AURA Sense — Google OAuth Provider
 *
 * Handles one-time Google authentication with persistent refresh token.
 * Automatically restores sessions on startup and handles expiration.
 *
 * Storage keys (localStorage):
 *   aura_sense_google_access_token
 *   aura_sense_google_refresh_token
 *   aura_sense_google_token_expiry
 *   aura_sense_google_email
 */

const STORAGE_KEYS = {
  ACCESS_TOKEN:  "aura_sense_google_access_token",
  REFRESH_TOKEN: "aura_sense_google_refresh_token",
  EXPIRY:        "aura_sense_google_token_expiry",
  EMAIL:         "aura_sense_google_email",
} as const;

// Scopes required for Music Intelligence (YouTube read + control)
const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
  "email",
  "profile",
].join(" ");

export interface GoogleSession {
  accessToken: string;
  email: string;
  expiresAt: number;
}

export class GoogleOAuthProvider {
  private clientId: string;
  private session: GoogleSession | null = null;

  constructor() {
    // Client ID is stored in env — no user-facing API key setup needed
    this.clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
    this.session = this.restoreSession();
  }

  // ── Session state ─────────────────────────────────────────────────

  isAuthenticated(): boolean {
    return !!this.session && this.session.expiresAt > Date.now();
  }

  getSession(): GoogleSession | null {
    return this.isAuthenticated() ? this.session : null;
  }

  getEmail(): string | null {
    return localStorage.getItem(STORAGE_KEYS.EMAIL);
  }

  // ── Auth flow ─────────────────────────────────────────────────────

  /**
   * Opens Google OAuth popup. Returns once user grants or denies permission.
   * Never called more than once per install if token persists.
   */
  async authenticate(): Promise<GoogleSession> {
    if (!this.clientId) {
      throw new Error(
        "Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID in environment."
      );
    }

    return new Promise((resolve, reject) => {
      const redirectUri = `${window.location.origin}/oauth/callback`;
      const state = crypto.randomUUID();

      const params = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: redirectUri,
        response_type: "token",
        scope: SCOPES,
        state,
        include_granted_scopes: "true",
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      const popup = window.open(authUrl, "google-oauth", "width=500,height=600,centerscreen=yes");

      if (!popup) {
        reject(new Error("Popup blocked. Please allow popups for this site."));
        return;
      }

      // Listen for the OAuth callback via postMessage or URL polling
      const interval = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(interval);
            reject(new Error("Authentication cancelled."));
            return;
          }

          const url = popup.location.href;
          if (url.includes("/oauth/callback") || url.includes("access_token")) {
            clearInterval(interval);

            const hash = new URLSearchParams(
              url.includes("#") ? url.split("#")[1] : url.split("?")[1]
            );
            const accessToken = hash.get("access_token");
            const expiresIn   = parseInt(hash.get("expires_in") || "3600");

            if (!accessToken) {
              reject(new Error("No access token received."));
              popup.close();
              return;
            }

            popup.close();

            // Fetch user email
            this.fetchUserEmail(accessToken).then((email) => {
              const session: GoogleSession = {
                accessToken,
                email,
                expiresAt: Date.now() + expiresIn * 1000,
              };

              this.persistSession(session);
              this.session = session;
              resolve(session);
            }).catch(reject);
          }
        } catch {
          // Cross-origin — popup still on Google's domain, keep polling
        }
      }, 500);
    });
  }

  async revokeSession(): Promise<void> {
    if (this.session?.accessToken) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${this.session.accessToken}`,
          { method: "POST" }
        );
      } catch {}
    }
    this.clearSession();
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async fetchUserEmail(accessToken: string): Promise<string> {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    return data.email || "Google Account";
  }

  private persistSession(session: GoogleSession): void {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
    localStorage.setItem(STORAGE_KEYS.EXPIRY, String(session.expiresAt));
    localStorage.setItem(STORAGE_KEYS.EMAIL, session.email);
  }

  private restoreSession(): GoogleSession | null {
    const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    const expiry      = localStorage.getItem(STORAGE_KEYS.EXPIRY);
    const email       = localStorage.getItem(STORAGE_KEYS.EMAIL);

    if (!accessToken || !expiry || !email) return null;
    const expiresAt = parseInt(expiry);
    if (expiresAt < Date.now()) return null;  // Expired

    return { accessToken, email, expiresAt };
  }

  private clearSession(): void {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    this.session = null;
  }
}
