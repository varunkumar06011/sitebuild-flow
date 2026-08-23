import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const registersRouter = Router();

// GET /api/registers/visitors
registersRouter.get("/visitors", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const page = Number(req.query["page"] ?? 1);
    const limit = Number(req.query["limit"] ?? 50);
    const offset = (page - 1) * limit;

    const { data: visitors, count } = await supabaseServer
      .from("visitors")
      .select("id, name, org, purpose, in_time, out_time, host", { count: "exact" })
      .order("in_time", { ascending: false })
      .range(offset, offset + limit - 1);

    res.json({ data: visitors ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchVisitors error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch visitors" });
  }
});

// GET /api/registers/vehicles
registersRouter.get("/vehicles", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const page = Number(req.query["page"] ?? 1);
    const limit = Number(req.query["limit"] ?? 50);
    const offset = (page - 1) * limit;

    const { data: vehicles, count } = await supabaseServer
      .from("vehicles")
      .select("id, number, type, driver, material, in_time, out_time", { count: "exact" })
      .order("in_time", { ascending: false })
      .range(offset, offset + limit - 1);

    res.json({ data: vehicles ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchVehicles error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch vehicles" });
  }
});

// POST /api/registers/visitors/create
const visitorSchema = z.object({
  name: z.string().min(1),
  org: z.string().optional(),
  purpose: z.string().optional(),
  host: z.string().optional(),
});

registersRouter.post("/visitors/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = visitorSchema.parse(req.body);

    const { data: visitor, error } = await supabaseServer
      .from("visitors")
      .insert(data)
      .select("id, name")
      .single();

    if (error || !visitor) {
      res.json({ success: false, error: "Failed to check in visitor" });
      return;
    }

    await logAction(user, "create_visitor", "visitor", visitor.id, { name: visitor.name });
    res.json({ success: true, id: visitor.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createVisitor error:", err);
    res.status(500).json({ success: false, error: "Failed to check in visitor" });
  }
});

// POST /api/registers/vehicles/create
const vehicleSchema = z.object({
  number: z.string().min(1),
  type: z.string().optional(),
  driver: z.string().optional(),
  material: z.string().optional(),
});

registersRouter.post("/vehicles/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = vehicleSchema.parse(req.body);

    const { data: vehicle, error } = await supabaseServer
      .from("vehicles")
      .insert(data)
      .select("id, number")
      .single();

    if (error || !vehicle) {
      res.json({ success: false, error: "Failed to log vehicle entry" });
      return;
    }

    await logAction(user, "create_vehicle", "vehicle", vehicle.id, { number: vehicle.number });
    res.json({ success: true, id: vehicle.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createVehicle error:", err);
    res.status(500).json({ success: false, error: "Failed to log vehicle entry" });
  }
});

// POST /api/registers/visitors/checkout
registersRouter.post("/visitors/checkout", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer
      .from("visitors")
      .update({ out_time: new Date().toISOString() })
      .eq("id", id)
      .is("out_time", "null");

    if (error) {
      res.json({ success: false, error: "Failed to check out visitor" });
      return;
    }

    await logAction(user, "checkout_visitor", "visitor", id, {});
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
    console.error("checkOutVisitor error:", err);
    res.status(500).json({ success: false, error: "Failed to check out visitor" });
  }
});

// POST /api/registers/vehicles/checkout
registersRouter.post("/vehicles/checkout", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer
      .from("vehicles")
      .update({ out_time: new Date().toISOString() })
      .eq("id", id)
      .is("out_time", "null");

    if (error) {
      res.json({ success: false, error: "Failed to check out vehicle" });
      return;
    }

    await logAction(user, "checkout_vehicle", "vehicle", id, {});
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
    console.error("checkOutVehicle error:", err);
    res.status(500).json({ success: false, error: "Failed to check out vehicle" });
  }
});
