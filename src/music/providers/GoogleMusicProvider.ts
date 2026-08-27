import { MusicProviderAdapter, MusicProviderId, ConnectionState } from '../types/provider';
import { googleIdentityService } from '../../auth/GoogleIdentityService';

export class GoogleMusicProvider implements MusicProviderAdapter {
  id: MusicProviderId;
  name: string;
  
  private connectionState: ConnectionState = "disconnected";
  private lastError: string | null = null;
  
  constructor(id: MusicProviderId, name: string) {
    this.id = id;
    this.name = name;
    
    // Initialize state from existing session
    if (googleIdentityService.isAuthenticated()) {
      // In the future, we could store which provider was connected.
      // For now, if there's a valid sense session, both might appear connected, 
      // or we can store a specific flag per provider if needed.
      // To strictly adhere to "independent states", let's store provider connection choice in localStorage.
      const connectedProvider = localStorage.getItem('aura_music_connected_provider');
      if (connectedProvider === this.id) {
        this.connectionState = "connected";
      } else {
        this.connectionState = "disconnected";
      }
    } else {
      this.connectionState = "disconnected";
    }
  }

  async connect(): Promise<void> {
    this.lastError = null;
    this.connectionState = "connecting";
    this.notifyStateChange();

    try {
      // Small artificial delay for UI transition (Connecting -> Authorizing)
      await new Promise(res => setTimeout(res, 500));
      
      this.connectionState = "authorizing";
      this.notifyStateChange();
      
      await googleIdentityService.authenticate(true);
      
      // Explicitly mark this provider as the connected one
      localStorage.setItem('aura_music_connected_provider', this.id);
      
      this.connectionState = "connected";
      this.notifyStateChange();
    } catch (e: any) {
      this.lastError = e.message || "Google authorization failed.";
      this.connectionState = "error";
      this.notifyStateChange();
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    googleIdentityService.logout();
    localStorage.removeItem('aura_music_connected_provider');
    this.connectionState = "disconnected";
    this.lastError = null;
    this.notifyStateChange();
  }

  getConnectionState(): ConnectionState {
    // Re-verify session validity dynamically
    if (this.connectionState === "connected" && !googleIdentityService.isAuthenticated()) {
      this.connectionState = "revoked";
      localStorage.removeItem('aura_music_connected_provider');
    }
    return this.connectionState;
  }

  getAccountEmail(): string | null {
    if (this.getConnectionState() === "connected") {
      const session = googleIdentityService.getSession();
      return session?.email || null;
    }
    return null;
  }

  getLastError(): string | null {
    return this.lastError;
  }
  
  // Basic observer pattern for UI updates
  private listeners: Array<() => void> = [];
  
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  private notifyStateChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// Singleton instances for the two providers
export const youtubeProvider = new GoogleMusicProvider("youtube", "YouTube");
export const youtubeMusicProvider = new GoogleMusicProvider("youtube_music", "YouTube Music");
