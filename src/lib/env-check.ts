const requiredServerEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_JWT_SECRET",
] as const;

const requiredClientEnvVars = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
] as const;

export function checkServerEnv(): void {
  const missing = requiredServerEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variables: ${missing.join(", ")}. ` +
        `Check your .env file and ensure all required variables are set.`,
    );
  }
}

export function checkClientEnv(): void {
  const missing = requiredClientEnvVars.filter(
    (key) => !import.meta.env[key],
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required client environment variables: ${missing.join(", ")}. ` +
        `Check your .env file and ensure all required variables are set.`,
    );
  }
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env["FIREBASE_PROJECT_ID"] &&
      process.env["FIREBASE_CLIENT_EMAIL"] &&
      process.env["FIREBASE_PRIVATE_KEY"],
  );
}
