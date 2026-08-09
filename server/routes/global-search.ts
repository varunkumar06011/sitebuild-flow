import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";

export const globalSearchRouter = Router();

const MAX_PER_TYPE = 5;
const MIN_QUERY_LENGTH = 2;

// GET /api/global-search?q=...
globalSearchRouter.get("/", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const query = ((req.query["q"] as string) ?? "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      res.json({ data: [] });
      return;
    }

    const pattern = `%${query}%`;
    const results: any[] = [];

    const [requisitions, vendors, items, gatePasses, equipment, batches] = await Promise.all([
      supabaseServer.from("requisitions").select("id, pr_number, po_number, title, stage").or(`pr_number.ilike.${pattern},po_number.ilike.${pattern},title.ilike.${pattern}`).order("date", { ascending: false }).limit(MAX_PER_TYPE).then(({ data }) => data ?? []),
      supabaseServer.from("vendors").select("id, name, category, status").ilike("name", pattern).order("name", { ascending: true }).limit(MAX_PER_TYPE).then(({ data }) => data ?? []),
      supabaseServer.from("inventory_stock_levels").select("item_id, item_name, unit_of_measure, current_stock").ilike("item_name", pattern).order("item_name", { ascending: true }).limit(MAX_PER_TYPE).then(({ data }) => data ?? []),
      supabaseServer.from("gate_passes").select("id, gp_number, material, status").or(`gp_number.ilike.${pattern},material.ilike.${pattern}`).order("created_at", { ascending: false }).limit(MAX_PER_TYPE).then(({ data }) => data ?? []),
      supabaseServer.from("medical_equipment").select("id, name, serial_number, manufacturer, status").or(`name.ilike.${pattern},serial_number.ilike.${pattern}`).order("name", { ascending: true }).limit(MAX_PER_TYPE).then(({ data }) => data ?? []),
      supabaseServer.from("batches").select("id, batch_number, material_name, status").ilike("batch_number", pattern).order("created_at", { ascending: false }).limit(MAX_PER_TYPE).then(({ data }) => data ?? []),
    ]);

    for (const r of requisitions) {
      results.push({ type: "Requisition", id: r.id, label: r.pr_number ?? "—", sublabel: `${r.title ?? ""} · ${r.stage ?? ""}`, route: `/procurement?id=${r.id}` });
    }
    for (const v of vendors) {
      results.push({ type: "Vendor", id: v.id, label: v.name, sublabel: `${v.category ?? ""} · ${v.status ?? ""}`, route: `/vendors?id=${v.id}` });
    }
    for (const i of items) {
      results.push({ type: "Inventory Item", id: i.item_id, label: i.item_name, sublabel: `Stock: ${i.current_stock} ${i.unit_of_measure ?? ""}`, route: `/inventory?tab=items` });
    }
    for (const g of gatePasses) {
      results.push({ type: "Gate Pass", id: g.id, label: g.gp_number ?? "—", sublabel: `${g.material ?? ""} · ${g.status ?? ""}`, route: `/gate-pass?id=${g.id}` });
    }
    for (const e of equipment) {
      results.push({ type: "Equipment", id: e.id, label: e.name, sublabel: `S/N: ${e.serial_number ?? "—"} · ${e.manufacturer ?? ""}`, route: `/medical-equipment?id=${e.id}` });
    }
    for (const b of batches) {
      results.push({ type: "Batch", id: b.id, label: b.batch_number, sublabel: `${b.material_name ?? ""} · ${b.status ?? ""}`, route: `/traceability?id=${b.id}` });
    }

    res.json({ data: results });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("globalEntitySearch error:", err);
    res.status(500).json({ data: [], error: "Failed to search" });
  }
});
