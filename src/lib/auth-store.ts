import type { Role } from "./erp-data";

// Shape of the client-side authentication state persisted to localStorage.
export type AuthState = {
  role: Role | null;
  name: string | null;
  isAuthenticated: boolean;
};

const STORAGE_KEY = "meditrust-auth-user";

let state: AuthState = { role: null, name: null, isAuthenticated: false };
const listeners = new Set<() => void>();

// Notifies all subscribed listeners that auth state has changed.
function notify() {
  listeners.forEach((l) => l());
}

// Initialize synchronously from localStorage so state is available
// before the router's beforeLoad runs (prevents redirect loop on refresh)
if (typeof window !== "undefined") {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      state = JSON.parse(saved) as AuthState;
    } catch {
      // ignore corrupt storage
    }
  }
}

// Lightweight reactive auth store backed by localStorage, used for client-side route guards.
export const authStore = {
  getState: () => state,

  setUser: (user: { role: Role; name: string }) => {
    state = { role: user.role, name: user.name, isAuthenticated: true };
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    notify();
  },

  logout: () => {
    state = { role: null, name: null, isAuthenticated: false };
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    notify();
  },

  init: () => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          state = JSON.parse(saved) as AuthState;
          notify();
        } catch {
          // ignore corrupt storage
        }
      }
    }
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
