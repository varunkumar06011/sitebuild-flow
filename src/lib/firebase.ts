// Firebase client SDK — lazily initialized inside browser event handlers only.
// Dynamic imports keep firebase/auth out of the SSR bundle (it needs window/DOM).

type FirebaseAuth = {
  signInWithPhoneNumber: (auth: unknown, phone: string, verifier: unknown) => Promise<unknown>;
  RecaptchaVerifier: new (
    auth: unknown,
    container: string,
    opts: { size: "invisible" },
  ) => unknown & {
    clear: () => void;
    render: () => Promise<number>;
  };
  getAuth: (app: unknown) => unknown;
};

type FirebaseApp = {
  initializeApp: (config: Record<string, string>) => unknown;
  getApps: () => unknown[];
};

let authInstance: unknown | null = null;
let recaptchaVerifier:
  (FirebaseAuth["RecaptchaVerifier"] extends new (...a: infer A) => infer R ? R : never) | null =
  null;

// Initializes and returns the Firebase Auth instance (browser only).
async function getFirebaseAuth(): Promise<unknown> {
  if (authInstance) return authInstance;
  const appMod = (await import("firebase/app")) as unknown as FirebaseApp;
  const authMod = (await import("firebase/auth")) as unknown as FirebaseAuth;

  const config = {
    apiKey: import.meta.env["VITE_FIREBASE_API_KEY"] as string,
    authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"] as string,
    projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"] as string,
    storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"] as string,
    messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] as string,
    appId: import.meta.env["VITE_FIREBASE_APP_ID"] as string,
  };

  const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(config);
  authInstance = authMod.getAuth(app);
  return authInstance;
}

// Returns a reusable reCAPTCHA verifier, clearing any prior instance first.
// Creating a new verifier on the same container without clear() throws
// "reCAPTCHA has already been rendered in this element".
async function getRecaptchaVerifier(auth: unknown): Promise<NonNullable<typeof recaptchaVerifier>> {
  const { RecaptchaVerifier } = (await import("firebase/auth")) as unknown as FirebaseAuth;
  if (recaptchaVerifier) {
    try {
      recaptchaVerifier.clear();
    } catch {
      // ignore — already destroyed
    }
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
  return recaptchaVerifier;
}

// A Firebase confirmation result returned by signInWithPhoneNumber.
export type PhoneConfirmationResult = {
  confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
};

// Sends an OTP SMS to the given phone via Firebase Phone Auth.
// Requires a #recaptcha-container element in the DOM (invisible reCAPTCHA).
export async function sendPhoneOtp(phone: string): Promise<PhoneConfirmationResult> {
  const auth = await getFirebaseAuth();
  const verifier = await getRecaptchaVerifier(auth);
  return (await ((await import("firebase/auth")) as unknown as FirebaseAuth).signInWithPhoneNumber(
    auth,
    phone,
    verifier,
  )) as PhoneConfirmationResult;
}

// Confirms the OTP code against a prior confirmation result and returns the ID token.
export async function confirmPhoneOtp(
  confirmation: PhoneConfirmationResult,
  code: string,
): Promise<string> {
  const credential = await confirmation.confirm(code);
  return credential.user.getIdToken();
}
