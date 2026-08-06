import type { Role } from "./erp-data";

type AuthState = {
  role: Role | null;
  isAuthenticated: boolean;
};

const STORAGE_KEY = "meditrust-auth";

let state: AuthState = { role: null, isAuthenticated: false };
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export const authStore = {
  getState: () => state,

  login: (role: Role) => {
    state = { role, isAuthenticated: true };
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    notify();
  },

  logout: () => {
    state = { role: null, isAuthenticated: false };
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
