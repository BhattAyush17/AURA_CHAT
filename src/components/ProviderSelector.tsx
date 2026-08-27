import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { hasUserKey, clearProviderCredentials } from "@/lib/credentials";
import { connectionState } from "@/config/connectionState";

interface ProviderSelectorProps {
  activeBrain: "gemini" | "openrouter" | "sarvam";
  onChange: (provider: "gemini" | "openrouter" | "sarvam") => void;
  status: string;
  endSession: () => void;
}

type ConnectionStatus = "connected" | "checking" | "missing_keys" | "offline" | "error";

interface ProviderInfo {
  id: "gemini" | "openrouter" | "sarvam";
  name: string;
  subtitle: string;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "gemini", name: "Gemini Live", subtitle: "Multimodal Voice" },
  { id: "openrouter", name: "OpenRouter", subtitle: "LLM Routing" },
  { id: "sarvam", name: "Sarvam AI", subtitle: "Indian Voice" },
];

export function ProviderSelector({ activeBrain, onChange, status, endSession }: ProviderSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("checking");
  const [statusMessage, setStatusMessage] = useState("Verifying Connection...");
  const dropdownRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Helper to determine key existence
  const checkKeys = useCallback((provider: "gemini" | "openrouter" | "sarvam"): boolean => {
    if (provider === "gemini") return hasUserKey("aura_gemini_api_key");
    if (provider === "sarvam") return hasUserKey("openrouter_api_key") && hasUserKey("sarvam_api_key");
    return hasUserKey("openrouter_api_key");
  }, []);

  // Update status based on conditions
  const updateStatus = useCallback((provider: "gemini" | "openrouter" | "sarvam") => {
    if (typeof window !== "undefined" && !navigator.onLine) {
      setConnStatus("offline");
      setStatusMessage("Offline");
      return;
    }

    const hasKeys = checkKeys(provider);
    if (!hasKeys) {
      setConnStatus("missing_keys");
      setStatusMessage("API Key Required");
      return;
    }

    const cs = connectionState.getState();
    if (provider === "sarvam" && !cs.sarvam_available && cs.init_complete) {
      setConnStatus("error");
      setStatusMessage("Provider Unavailable");
      return;
    }

    // Default to connected if keys exist and we are online
    setConnStatus("connected");
    setStatusMessage(provider === "gemini" ? "Ready" : "Connected");
  }, [checkKeys]);

  // Handle provider switch and simulate connection check
  const handleSelect = (providerId: "gemini" | "openrouter" | "sarvam") => {
    setIsOpen(false);
    if (providerId === activeBrain) return;

    setConnStatus("checking");
    setStatusMessage("Checking Connection");

    // Enforce BYOK ephemeral lifecycle: clear AI credentials on provider switch
    clearProviderCredentials();

    // Trigger state changes
    onChange(providerId);

    // Fade transition / status refresh delay
    setTimeout(() => {
      updateStatus(providerId);
    }, 450);
  };

  // Listen to network status / connectionState updates / credential updates
  useEffect(() => {
    updateStatus(activeBrain);

    const handleOnlineStatus = () => updateStatus(activeBrain);
    const handleCredentialsUpdated = () => updateStatus(activeBrain);
    
    window.addEventListener("online", handleOnlineStatus);
    window.addEventListener("offline", handleOnlineStatus);
    window.addEventListener("aura_credentials_updated", handleCredentialsUpdated);

    const unsubscribe = connectionState.subscribe(() => {
      updateStatus(activeBrain);
    });

    return () => {
      window.removeEventListener("online", handleOnlineStatus);
      window.removeEventListener("offline", handleOnlineStatus);
      window.removeEventListener("aura_credentials_updated", handleCredentialsUpdated);
      unsubscribe();
    };
  }, [activeBrain, updateStatus]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setFocusedIndex(0);
      } else {
        setFocusedIndex((prev) => (prev + 1) % PROVIDERS.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isOpen) {
        setFocusedIndex((prev) => (prev - 1 + PROVIDERS.length) % PROVIDERS.length);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else if (focusedIndex >= 0 && focusedIndex < PROVIDERS.length) {
        handleSelect(PROVIDERS[focusedIndex].id);
      }
    }
  };

  // Get active provider details
  const activeProvider = PROVIDERS.find((p) => p.id === activeBrain) || PROVIDERS[0];

  return (
    <div className="relative inline-block text-left select-none">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="group flex items-center gap-2 bg-transparent text-left focus:outline-none transition-all duration-120 hover:opacity-80 cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {/* Status Indicator */}
        <div className="flex items-center shrink-0 w-3.5 justify-center">
          {connStatus === "checking" ? (
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
              className="text-xs text-white/50 font-semibold"
            >
              ○
            </motion.span>
          ) : (
            <span
              className={`h-1.5 w-1.5 rounded-full transition-all duration-250 ${
                connStatus === "connected"
                  ? "bg-white shadow-[0_0_5px_rgba(52,211,153,0.7)]"
                  : "bg-red-500/70"
              }`}
            />
          )}
        </div>

        {/* Text Details (Responsive layout rules) */}
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-medium tracking-[0.03em] uppercase text-white group-hover:underline decoration-white/20 transition-all duration-120">
            {activeProvider.name}
          </span>
          
          {/* Secondary Status Line: hidden on mobile, visible on tablet/desktop */}
          <span className="hidden sm:inline text-[9px] font-normal text-white/55 leading-none transition-opacity duration-120">
            {statusMessage}
          </span>
        </div>

        <ChevronDown className="h-3 w-3 text-white/40 shrink-0 group-hover:text-white/60 transition-colors" strokeWidth={1.5} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.ul
            ref={dropdownRef}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute left-0 mt-2 w-[160px] rounded-lg bg-[#050505] shadow-2xl py-1 z-50 overflow-hidden outline-none border border-white/[0.04]"
            role="listbox"
          >
            {PROVIDERS.map((provider, index) => {
              const isSelected = provider.id === activeBrain;
              const isFocused = index === focusedIndex;

              return (
                <li
                  key={provider.id}
                  onClick={() => handleSelect(provider.id)}
                  onMouseEnter={() => setFocusedIndex(index)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors duration-120 ${
                    isSelected ? "bg-white/[0.06]" : ""
                  } ${isFocused ? "bg-white/[0.04]" : ""} hover:bg-white/[0.04]`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="text-[9px] font-medium tracking-[0.03em] uppercase text-white truncate">
                    {provider.name}
                  </span>
                  {isSelected && (
                    <span className="h-1 w-1 rounded-full bg-white" />
                  )}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
