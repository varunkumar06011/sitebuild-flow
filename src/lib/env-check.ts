const requiredServerEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_JWT_SECRET",
] as const;

const requiredClientEnvVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;

// Throws if any required server-side environment variables are missing.
export function checkServerEnv(): void {
  const missing = requiredServerEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variables: ${missing.join(", ")}. ` +
        `Check your .env file and ensure all required variables are set.`,
    );
  }
}

// Throws if any required client-side (Vite) environment variables are missing.
export function checkClientEnv(): void {
  const missing = requiredClientEnvVars.filter((key) => !import.meta.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required client environment variables: ${missing.join(", ")}. ` +
        `Check your .env file and ensure all required variables are set.`,
    );
  }
}

// Returns true when all Firebase service-account env vars needed for push notifications are present.
export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env["FIREBASE_PROJECT_ID"] &&
    process.env["FIREBASE_CLIENT_EMAIL"] &&
    process.env["FIREBASE_PRIVATE_KEY"],
  );
}

// Returns true when the Firebase client SDK (Phone Auth) env vars are present.
// These are Vite-prefixed so they are available on both client and server.
export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    import.meta.env["VITE_FIREBASE_API_KEY"] &&
    import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"] &&
    import.meta.env["VITE_FIREBASE_PROJECT_ID"] &&
    import.meta.env["VITE_FIREBASE_APP_ID"],
  );
}
