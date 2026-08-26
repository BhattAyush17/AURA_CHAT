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

export class GoogleIdentityService {
  private clientId: string;
  private session: GoogleSession | null = null;

  constructor() {
    this.clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
    this.loadSession();
  }

  private loadSession() {
    try {
      const accessToken = sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const email = localStorage.getItem(STORAGE_KEYS.EMAIL);
      const expiry = localStorage.getItem(STORAGE_KEYS.EXPIRY);

      if (accessToken && email && expiry) {
        this.session = {
          accessToken,
          email,
          expiresAt: parseInt(expiry, 10),
        };
      }
    } catch (e) {
      console.warn("[GoogleIdentityService] Failed to load session", e);
    }
  }

  private saveSession(accessToken: string, expiresIn: number, email: string, persist: boolean = true) {
    const expiresAt = Date.now() + expiresIn * 1000;
    this.session = { accessToken, email, expiresAt };

    try {
      if (persist) {
        localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
        localStorage.setItem(STORAGE_KEYS.EMAIL, email);
        localStorage.setItem(STORAGE_KEYS.EXPIRY, expiresAt.toString());
      } else {
        sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
        localStorage.setItem(STORAGE_KEYS.EMAIL, email);
        localStorage.setItem(STORAGE_KEYS.EXPIRY, expiresAt.toString());
      }
    } catch (e) {
      console.warn("[GoogleIdentityService] Failed to save session", e);
    }
  }

  getSession(): GoogleSession | null {
    return this.session;
  }

  isAuthenticated(): boolean {
    return !!this.session && Date.now() < this.session.expiresAt;
  }

  async authenticate(persist: boolean = true): Promise<GoogleSession> {
    if (this.isAuthenticated()) {
      return this.session!;
    }

    if (!this.clientId) {
      throw new Error("Missing VITE_GOOGLE_CLIENT_ID");
    }

    return new Promise((resolve, reject) => {
      const redirectUri = window.location.origin;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      
      authUrl.searchParams.append("client_id", this.clientId);
      authUrl.searchParams.append("redirect_uri", redirectUri);
      authUrl.searchParams.append("response_type", "token");
      authUrl.searchParams.append("scope", SCOPES);
      authUrl.searchParams.append("include_granted_scopes", "true");
      authUrl.searchParams.append("prompt", "consent");

      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        authUrl.toString(),
        "Google Auth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        reject(new Error("Popup blocked. Please allow popups for this site."));
        return;
      }

      const messageListener = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
          window.removeEventListener("message", messageListener);
          popup.close();

          const hashParams = new URLSearchParams(event.data.hash.replace("#", "?"));
          const accessToken = hashParams.get("access_token");
          const expiresIn = parseInt(hashParams.get("expires_in") || "3600", 10);

          if (accessToken) {
            this.fetchProfile(accessToken).then(email => {
              this.saveSession(accessToken, expiresIn, email, persist);
              resolve(this.session!);
            }).catch(reject);
          } else {
            reject(new Error("No access token returned"));
          }
        }
      };

      window.addEventListener("message", messageListener);

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener("message", messageListener);
          if (!this.isAuthenticated()) {
            reject(new Error("Authentication cancelled"));
          }
        }
      }, 500);
    });
  }

  private async fetchProfile(accessToken: string): Promise<string> {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      return data.email || "user@gmail.com";
    } catch (e) {
      console.warn("Could not fetch profile email", e);
      return "user@gmail.com";
    }
  }

  logout() {
    this.session = null;
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.EMAIL);
    localStorage.removeItem(STORAGE_KEYS.EXPIRY);
    sessionStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  }
}

export const googleIdentityService = new GoogleIdentityService();
