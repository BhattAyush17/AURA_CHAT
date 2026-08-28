import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";
import { musicService } from "./music/MusicService";

(window as any).musicService = musicService;

// Log a warning (not a crash) if VITE_API_BASE is unset.
// The behavior engine is optional — the app runs fine without it.
// config/api.ts already falls back to localhost:8000.
if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE) {
  console.warn(
    "⚠️ VITE_API_BASE is not set. Behavior engine calls will target http://localhost:8000. " +
      "Copy .env.example → .env.local if you need to point to a different backend.",
  );
}

const router = getRouter();

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}
