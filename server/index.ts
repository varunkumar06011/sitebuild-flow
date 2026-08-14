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
import { batchesRouter } from "./routes/batches.js";
import { inspectionsRouter } from "./routes/inspections.js";
import { budgetRouter } from "./routes/budget.js";
import { cashFlowRouter } from "./routes/cash-flow.js";
import { progressRouter } from "./routes/progress.js";
import { workCategoriesRouter } from "./routes/work-categories.js";
import { systemRobustnessRouter } from "./routes/system-robustness.js";
import { usersRouter } from "./routes/users.js";
import { drawingsRouter } from "./routes/drawings.js";
import { documentsRouter } from "./routes/documents.js";
import { notificationSystemRouter } from "./routes/notification-system.js";
import { globalSearchRouter } from "./routes/global-search.js";
import { requisitionsRouter } from "./routes/requisitions.js";
import { gatePassesRouter } from "./routes/gate-passes.js";
import { registersRouter } from "./routes/registers.js";
import { settingsRouter } from "./routes/settings.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { dailyDiaryRouter } from "./routes/daily-diary.js";
import { inventoryRouter } from "./routes/inventory.js";
import { progressTrackingRouter } from "./routes/progress-tracking.js";
import { workOrdersRouter } from "./routes/work-orders.js";
import { partsOrdersRouter } from "./routes/parts-orders.js";
import { vendorPortalRouter } from "./routes/vendor-portal.js";
import { clientPortalRouter } from "./routes/client-portal.js";
import { portalAuthRouter } from "./routes/portal-auth.js";

// Verify required environment variables are set before starting.
checkServerEnv();

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// CORS configuration: credentials are required for cross-origin cookies.
// The origin must be explicit (not "*") when credentials are true.
// In production, set CORS_ORIGIN to the exact frontend URL.
// In development, allow any localhost port.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    // In development, always allow localhost / 127.0.0.1 so Vite's default URLs work with credentials.
    if (process.env["NODE_ENV"] !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return callback(null, true);
    }
    if (process.env["CORS_ORIGIN"]) {
      return callback(null, origin === process.env["CORS_ORIGIN"]);
    }
    if (process.env["NODE_ENV"] === "production") {
      return callback(null, false);
    }
    callback(null, false);
  },
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
app.use("/api/batches", batchesRouter);
app.use("/api/inspections", inspectionsRouter);
app.use("/api/budget", budgetRouter);
app.use("/api/cash-flow", cashFlowRouter);
app.use("/api/progress", progressRouter);
app.use("/api/work-categories", workCategoriesRouter);
app.use("/api/system-robustness", systemRobustnessRouter);
app.use("/api/users", usersRouter);
app.use("/api/drawings", drawingsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/notification-system", notificationSystemRouter);
app.use("/api/global-search", globalSearchRouter);
app.use("/api/requisitions", requisitionsRouter);
app.use("/api/gate-passes", gatePassesRouter);
app.use("/api/registers", registersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/daily-diary", dailyDiaryRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/progress-tracking", progressTrackingRouter);
app.use("/api/work-orders", workOrdersRouter);
app.use("/api/parts-orders", partsOrdersRouter);
app.use("/api/vendor-portal", vendorPortalRouter);
app.use("/api/client-portal", clientPortalRouter);
app.use("/api/portal-auth", portalAuthRouter);

// Centralized error handler — catches errors from all routes
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Meditrust ERP API server running on port ${PORT}`);
  console.log(`CORS origin: ${process.env["NODE_ENV"] === "production" ? process.env["CORS_ORIGIN"] || "(not set)" : "localhost / 127.0.0.1 (dev)"}`);
});

export default app;
