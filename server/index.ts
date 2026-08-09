import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { checkServerEnv } from "./lib/env-check.js";
import { authRouter } from "./routes/auth.js";
import { vendorsRouter } from "./routes/vendors.js";
import { storageRouter } from "./routes/storage.js";
import { notificationsRouter } from "./routes/notifications.js";
import { errorsRouter } from "./routes/errors.js";
import { auditRouter } from "./routes/audit.js";

// Verify required environment variables are set before starting.
checkServerEnv();

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// Allowed origin for CORS — the frontend URL.
// In production, this must be set to the exact Vercel URL (not "*").
// In development, allow localhost on any port.
const allowedOrigin =
  process.env["CORS_ORIGIN"] ??
  (process.env["NODE_ENV"] === "production" ? "" : "http://localhost:5173");

// CORS configuration: credentials are required for cross-origin cookies.
// The origin must be explicit (not "*") when credentials are true.
const corsOptions: cors.CorsOptions = {
  origin: allowedOrigin || true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "15mb" })); // large limit for base64 file uploads

// Health check endpoint for Railway
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount API routes
app.use("/api/auth", authRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/storage", storageRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/errors", errorsRouter);
app.use("/api/audit", auditRouter);

// Centralized error handler — catches errors from all routes
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Meditrust ERP API server running on port ${PORT}`);
  console.log(`CORS origin: ${allowedOrigin || "(any)"}`);
});

export default app;
