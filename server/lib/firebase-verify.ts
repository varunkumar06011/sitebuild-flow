import jwt from "jsonwebtoken";

// Google's public x509 certs for Firebase ID tokens (rotated periodically).
const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// In-memory cert cache (refreshed hourly; Google rotates keys ~monthly).
let certCache: { certs: Record<string, string>; fetchedAt: number } | null = null;

// Fetches and caches Google's public signing certs for Firebase ID tokens.
// Retries once on failure; falls back to stale cache if available.
async function getGoogleCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() - certCache.fetchedAt < 60 * 60 * 1000) {
    return certCache.certs;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(GOOGLE_CERTS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const certs = (await res.json()) as Record<string, string>;
      certCache = { certs, fetchedAt: Date.now() };
      return certs;
    } catch (e) {
      if (attempt === 0) continue;
      // On second failure, fall back to stale cache if we have one
      if (certCache) {
        return certCache.certs;
      }
      throw new Error("Failed to fetch Firebase public certs and no cache available");
    }
  }
  throw new Error("Failed to fetch Firebase public certs");
}

// Verifies a Firebase Phone-Auth ID token using Google's public certs.
// No service account required — only the project ID (audience) is needed.
// Returns the decoded payload (contains phone_number, sub, firebase.sign_in_provider).
export async function verifyFirebasePhoneToken(
  idToken: string,
  expectedProjectId: string,
): Promise<{
  sub: string;
  phone_number: string;
  firebase: { sign_in_provider: string };
}> {
  const decoded = jwt.decode(idToken, { complete: true }) as
    | { header?: { kid?: string } }
    | string
    | null;
  if (!decoded || typeof decoded === "string" || !decoded.header?.kid) {
    throw new Error("Malformed ID token");
  }

  const certs = await getGoogleCerts();
  const cert = certs[decoded.header.kid];
  if (!cert) throw new Error("Unknown signing key");

  const payload = jwt.verify(idToken, cert, {
    algorithms: ["RS256"],
    audience: expectedProjectId,
    issuer: `https://securetoken.google.com/${expectedProjectId}`,
  }) as {
    sub: string;
    phone_number?: string;
    firebase?: { sign_in_provider?: string };
  };

  if (!payload.sub) throw new Error("Token missing subject");
  if (payload.firebase?.sign_in_provider !== "phone") {
    throw new Error("Token is not from phone authentication");
  }
  if (!payload.phone_number) throw new Error("Token has no phone number");

  return {
    sub: payload.sub,
    phone_number: payload.phone_number,
    firebase: { sign_in_provider: payload.firebase.sign_in_provider },
  };
}

// Normalizes a phone number to a comparable form (digits only, keep leading +).
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  // If it started with +, compare with + prefix; otherwise compare digits only.
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}
