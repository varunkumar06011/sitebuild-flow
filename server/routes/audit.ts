import { Router, type Request, type Response } from "express";
import { fetchAuditLog } from "../lib/audit.js";

export const auditRouter = Router();

// GET /api/audit/fetch — fetches audit log (A1+ only).
auditRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    const data = {
      page: parseInt(req.query["page"] as string, 10) || undefined,
      limit: parseInt(req.query["limit"] as string, 10) || undefined,
      entityType: req.query["entityType"] as string | undefined,
      entityId: req.query["entityId"] as string | undefined,
    };
    const result = await fetchAuditLog(req, data);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Forbidden")) {
      res.status(403).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchAuditLog error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch audit log" });
  }
});
