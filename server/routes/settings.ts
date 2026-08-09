import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const settingsRouter = Router();

// GET /api/settings/fetch
settingsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data, error } = await supabaseServer
      .from("organization_settings")
      .select("id, name, gst_number, address, city, state, pincode, phone, email, logo_url")
      .limit(1)
      .single();

    if (error || !data) {
      res.json({ success: false, error: "Failed to fetch settings" });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchOrgSettings error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch settings" });
  }
});

// POST /api/settings/update
const settingsSchema = z.object({
  name: z.string().min(1),
  gst_number: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logo_url: z.string().optional(),
});

settingsRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "A1") {
      res.json({ success: false, error: "Only A1+ and A1 can update organization settings" });
      return;
    }
    const data = settingsSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("organization_settings")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabaseServer
        .from("organization_settings")
        .update(data)
        .eq("id", existing.id);

      if (error) {
        res.json({ success: false, error: "Failed to update settings" });
        return;
      }
      await logAction(user, "update_org_settings", "organization_settings", existing.id, data);
      res.json({ success: true });
      return;
    }

    const { data: created, error } = await supabaseServer
      .from("organization_settings")
      .insert(data)
      .select("id")
      .single();

    if (error || !created) {
      res.json({ success: false, error: "Failed to create settings" });
      return;
    }
    await logAction(user, "create_org_settings", "organization_settings", created.id, data);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateOrgSettings error:", err);
    res.status(500).json({ success: false, error: "Failed to update settings" });
  }
});
