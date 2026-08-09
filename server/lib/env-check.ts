const requiredServerEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_JWT_SECRET",
] as const;

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

// Returns true when all Firebase service-account env vars needed for push notifications are present.
export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env["FIREBASE_PROJECT_ID"] &&
      process.env["FIREBASE_CLIENT_EMAIL"] &&
      process.env["FIREBASE_PRIVATE_KEY"],
  );
}
