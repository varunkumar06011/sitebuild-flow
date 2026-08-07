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

let hydrated = false;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      state = JSON.parse(saved) as AuthState;
    } catch {
      // ignore corrupt storage
    }
  }
}

export const authStore = {
  getState: () => {
    hydrate();
    return state;
  },

  login: (role: Role) => {
    hydrated = true;
    state = { role, isAuthenticated: true };
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    notify();
  },

  logout: () => {
    hydrated = true;
    state = { role: null, isAuthenticated: false };
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    notify();
  },

  init: () => {
    hydrate();
    notify();
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
