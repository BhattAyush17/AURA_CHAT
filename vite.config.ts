import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// We are completely bypassing the Lovable TanStack config wrapper.
// This forces a pure, static Client-Side SPA build, removing all SSR errors.
export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss(), tsconfigPaths()],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: "hidden",
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react-dom/") || id.includes("/react/")) return "vendor-react";
          if (id.includes("/@tanstack/")) return "vendor-router";
          if (id.includes("/@supabase/")) return "vendor-supabase";
          if (id.includes("/@google/genai")) return "vendor-genai";
          if (id.includes("/framer-motion/")) return "vendor-motion";
          if (id.includes("/lucide-react/")) return "vendor-icons";
        },
      },
    },
  },
});
