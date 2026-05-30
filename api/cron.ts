export default async function handler(req: any, res: any) {
  // Pull the backend URL from the Vercel environment variables
  const backendUrl = process.env.VITE_API_BASE || "http://localhost:8000";
  
  try {
    // Forward the Vercel CRON authorization header to the actual Python backend
    const authHeader = req.headers.authorization;
    
    const response = await fetch(`${backendUrl}/api/cron/consolidate`, {
      method: "GET",
      headers: authHeader ? { "Authorization": authHeader } : undefined,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend responded with status: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    return res.status(200).json({ success: true, forwardedTo: backendUrl, proxyResponse: data });
  } catch (error: any) {
    console.error("Cron proxy failed:", error);
    return res.status(500).json({ success: false, forwardedTo: backendUrl, error: error.message });
  }
}
