// Global entity search — searches across real data records (not just navigation).
// Called by the Ctrl+K command palette to let users jump directly to a specific
// PR, vendor, gate pass, inventory item, equipment, or batch by partial name/number.
import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";

// Maximum results per entity type to keep the palette fast and uncluttered.
const MAX_PER_TYPE = 5;

// Minimum query length before we hit the database — avoids full-table scans
// on single-character queries.
const MIN_QUERY_LENGTH = 2;

// A single search result with enough info to render and navigate.
export type SearchResult = {
  type: string;
  id: string;
  label: string;
  sublabel: string;
  route: string;
};

// Searches across requisitions, vendors, inventory items, gate passes,
// medical equipment, and batches by partial name/number match.
// Returns categorized results limited to MAX_PER_TYPE per category.
export const globalEntitySearch = createServerFn({ method: "GET" })
  .validator((input: { query: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    const query = data.query.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return { data: [] as SearchResult[] };
    }

    const pattern = `%${query}%`;
    const results: SearchResult[] = [];

    // Run searches in parallel via Promise.all for speed
    const [requisitions, vendors, items, gatePasses, equipment, batches] = await Promise.all([
      // Requisitions — search by PR number, PO number, or title
      supabaseServer
        .from("requisitions")
        .select("id, pr_number, po_number, title, stage")
        .or(`pr_number.ilike.${pattern},po_number.ilike.${pattern},title.ilike.${pattern}`)
        .order("date", { ascending: false })
        .limit(MAX_PER_TYPE)
        .then(({ data }) => data ?? []),

      // Vendors — search by name
      supabaseServer
        .from("vendors")
        .select("id, name, category, status")
        .ilike("name", pattern)
        .order("name", { ascending: true })
        .limit(MAX_PER_TYPE)
        .then(({ data }) => data ?? []),

      // Inventory items — search by name via the stock levels view
      supabaseServer
        .from("inventory_stock_levels")
        .select("item_id, item_name, unit_of_measure, current_stock")
        .ilike("item_name", pattern)
        .order("item_name", { ascending: true })
        .limit(MAX_PER_TYPE)
        .then(({ data }) => data ?? []),

      // Gate passes — search by GP number or material
      supabaseServer
        .from("gate_passes")
        .select("id, gp_number, material, status")
        .or(`gp_number.ilike.${pattern},material.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(MAX_PER_TYPE)
        .then(({ data }) => data ?? []),

      // Medical equipment — search by name or serial number
      supabaseServer
        .from("medical_equipment")
        .select("id, name, serial_number, manufacturer, status")
        .or(`name.ilike.${pattern},serial_number.ilike.${pattern}`)
        .order("name", { ascending: true })
        .limit(MAX_PER_TYPE)
        .then(({ data }) => data ?? []),

      // Batches — search by batch number
      supabaseServer
        .from("batches")
        .select("id, batch_number, material_name, status")
        .ilike("batch_number", pattern)
        .order("created_at", { ascending: false })
        .limit(MAX_PER_TYPE)
        .then(({ data }) => data ?? []),
    ]);

    // Map results to SearchResult format
    for (const r of requisitions) {
      results.push({
        type: "Requisition",
        id: r.id,
        label: r.pr_number ?? "—",
        sublabel: `${r.title ?? ""} · ${r.stage ?? ""}`,
        route: `/procurement?id=${r.id}`,
      });
    }

    for (const v of vendors) {
      results.push({
        type: "Vendor",
        id: v.id,
        label: v.name,
        sublabel: `${v.category ?? ""} · ${v.status ?? ""}`,
        route: `/vendors?id=${v.id}`,
      });
    }

    for (const i of items) {
      results.push({
        type: "Inventory Item",
        id: i.item_id,
        label: i.item_name,
        sublabel: `Stock: ${i.current_stock} ${i.unit_of_measure ?? ""}`,
        route: `/inventory?tab=items`,
      });
    }

    for (const g of gatePasses) {
      results.push({
        type: "Gate Pass",
        id: g.id,
        label: g.gp_number ?? "—",
        sublabel: `${g.material ?? ""} · ${g.status ?? ""}`,
        route: `/gate-pass?id=${g.id}`,
      });
    }

    for (const e of equipment) {
      results.push({
        type: "Equipment",
        id: e.id,
        label: e.name,
        sublabel: `S/N: ${e.serial_number ?? "—"} · ${e.manufacturer ?? ""}`,
        route: `/medical-equipment?id=${e.id}`,
      });
    }

    for (const b of batches) {
      results.push({
        type: "Batch",
        id: b.id,
        label: b.batch_number,
        sublabel: `${b.material_name ?? ""} · ${b.status ?? ""}`,
        route: `/traceability?id=${b.id}`,
      });
    }

    return { data: results };
  });
