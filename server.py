"""
AURA Chat Server Entrypoint
Imports the core FastAPI application from backend.api.main to ensure
seamless deployment under both custom Procfile configurations and
default Render start commands.
"""

import os
from backend.api.main import app

if __name__ == "__main__":
    import uvicorn
    
    # Retrieve port from environment or fallback to 8000
    port = int(os.environ.get("PORT", 8000))
    
    # Run the server
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
