export class NetworkSupervisor {
  private _isOffline = false;
  private _rtt = 0;
  private _effectiveType = "4g";
  private _saveData = false;
  
  constructor() {
    if (typeof window !== "undefined") {
      this._isOffline = !navigator.onLine;
      
      window.addEventListener('offline', () => this._isOffline = true);
      window.addEventListener('online', () => this._isOffline = false);
      
      const conn = (navigator as any).connection;
      if (conn) {
        this.updateConnectionMetrics(conn);
        conn.addEventListener('change', () => this.updateConnectionMetrics(conn));
      }
    }
  }

  private updateConnectionMetrics(conn: any) {
    this._rtt = conn.rtt || 0;
    this._effectiveType = conn.effectiveType || "4g";
    this._saveData = conn.saveData || false;
    console.log(`[NetworkSupervisor] Network changed: ${this._effectiveType}, RTT: ${this._rtt}ms, DataSaver: ${this._saveData}`);
  }

  public get isOffline(): boolean {
    return this._isOffline;
  }

  public getNetworkReliabilityScore(): number {
    if (this._isOffline) return 0;
    
    let score = 100;
    
    if (this._saveData) score -= 30;
    
    if (this._effectiveType === "3g") score -= 20;
    else if (this._effectiveType === "2g") score -= 50;
    else if (this._effectiveType === "slow-2g") score -= 80;
    
    if (this._rtt > 500) score -= 30;
    else if (this._rtt > 200) score -= 10;
    
    return Math.max(0, score);
  }
}
