import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";

export const reportsRouter = Router();

// GET /api/reports/project-status
reportsRouter.get("/project-status", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select("id, stage, amount");
    const reqByStage: Record<string, { count: number; amount: number }> = {};
    let totalReqAmount = 0;
    (requisitions ?? []).forEach((r: any) => {
      const stage = r.stage ?? "Unknown";
      if (!reqByStage[stage]) reqByStage[stage] = { count: 0, amount: 0 };
      reqByStage[stage].count++;
      reqByStage[stage].amount += r.amount ?? 0;
      totalReqAmount += r.amount ?? 0;
    });

    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, total_amount, amount_paid, outstanding_amount, status");
    const totalCommitted = (vendors ?? []).reduce((s, v: any) => s + (v.total_amount ?? 0), 0);
    const totalPaid = (vendors ?? []).reduce((s, v: any) => s + (v.amount_paid ?? 0), 0);
    const totalOutstanding = (vendors ?? []).reduce(
      (s, v: any) => s + (v.outstanding_amount ?? 0),
      0,
    );
    const activeVendors = (vendors ?? []).filter((v: any) => v.status === "Active").length;

    const { data: inspections } = await supabaseServer.from("inspections").select("id, result");
    const qcPass = (inspections ?? []).filter((i: any) => i.result === "Pass").length;
    const qcFail = (inspections ?? []).filter((i: any) => i.result === "Fail").length;
    const qcReinspect = (inspections ?? []).filter((i: any) => i.result === "Re-inspection").length;

    const { data: gatePasses } = await supabaseServer.from("gate_passes").select("id, status");
    const gpActive = (gatePasses ?? []).filter(
      (g: any) => g.status === "Awaiting OTP" || g.status === "OTP Verified",
    ).length;
    const gpExited = (gatePasses ?? []).filter((g: any) => g.status === "Exited").length;

    const { data: batches } = await supabaseServer.from("batches").select("id, status");
    const batchVerified = (batches ?? []).filter((b: any) => b.status === "Verified").length;
    const batchPending = (batches ?? []).filter((b: any) => b.status === "Pending MTC").length;
    const batchTesting = (batches ?? []).filter((b: any) => b.status === "Under Test").length;

    const { data: budgets } = await supabaseServer.from("budgets").select("budgeted_amount");
    const totalBudget = (budgets ?? []).reduce((s, b: any) => s + (b.budgeted_amount ?? 0), 0);

    res.json({
      procurement: {
        by_stage: reqByStage,
        total_requisitions: requisitions?.length ?? 0,
        total_amount: totalReqAmount,
      },
      finance: {
        total_budget: totalBudget,
        total_committed: totalCommitted,
        total_paid: totalPaid,
        total_outstanding: totalOutstanding,
        active_vendors: activeVendors,
        budget_utilisation_pct:
          totalBudget > 0 ? Math.round((totalCommitted / totalBudget) * 100) : 0,
      },
      quality: {
        pass: qcPass,
        fail: qcFail,
        re_inspection: qcReinspect,
        total: inspections?.length ?? 0,
        pass_rate:
          (inspections?.length ?? 0) > 0
            ? Math.round((qcPass / (inspections?.length ?? 1)) * 100)
            : 0,
      },
      gate_pass: { active: gpActive, exited: gpExited, total: gatePasses?.length ?? 0 },
      traceability: {
        verified: batchVerified,
        pending_mtc: batchPending,
        under_test: batchTesting,
        total: batches?.length ?? 0,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchProjectStatus error:", err);
    res.status(500).json({ error: "Failed to fetch project status report" });
  }
});

// GET /api/reports/vendor-performance
reportsRouter.get("/vendor-performance", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select(
        "id, name, gst_number, total_amount, amount_paid, outstanding_amount, status, materials_purchased",
      )
      .order("total_amount", { ascending: false });

    const { data: payments } = await supabaseServer
      .from("vendor_payments")
      .select("vendor_id, amount, payment_date");
    const paymentMap: Record<string, { count: number; total: number }> = {};
    (payments ?? []).forEach((p: any) => {
      const vid = p.vendor_id;
      if (!paymentMap[vid]) paymentMap[vid] = { count: 0, total: 0 };
      paymentMap[vid].count++;
      paymentMap[vid].total += p.amount ?? 0;
    });

    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select("id, vendor_id, stage, delivery_date, date");
    const reqMap: Record<string, { count: number; delivered: number }> = {};
    (requisitions ?? []).forEach((r: any) => {
      const vid = r.vendor_id;
      if (!vid) return;
      if (!reqMap[vid]) reqMap[vid] = { count: 0, delivered: 0 };
      reqMap[vid].count++;
      if (r.delivery_date) reqMap[vid].delivered++;
    });

    const { data: tdsGst } = await supabaseServer
      .from("tds_gst_records")
      .select("vendor_id, record_type, status");
    const tdsGstMap: Record<string, { tds: number; gst: number; pending: number }> = {};
    (tdsGst ?? []).forEach((t: any) => {
      const vid = t.vendor_id;
      if (!tdsGstMap[vid]) tdsGstMap[vid] = { tds: 0, gst: 0, pending: 0 };
      if (t.record_type === "TDS") tdsGstMap[vid].tds++;
      else tdsGstMap[vid].gst++;
      if (t.status === "Pending") tdsGstMap[vid].pending++;
    });

    const enriched = (vendors ?? []).map((v: any) => {
      const pay = paymentMap[v.id] ?? { count: 0, total: 0 };
      const r = reqMap[v.id] ?? { count: 0, delivered: 0 };
      const tg = tdsGstMap[v.id] ?? { tds: 0, gst: 0, pending: 0 };
      const paymentProgress =
        v.total_amount > 0 ? Math.round((v.amount_paid / v.total_amount) * 100) : 0;
      const deliveryRate = r.count > 0 ? Math.round((r.delivered / r.count) * 100) : 0;
      return {
        id: v.id,
        name: v.name,
        gst_number: v.gst_number,
        status: v.status,
        materials_purchased: v.materials_purchased,
        total_amount: v.total_amount ?? 0,
        amount_paid: v.amount_paid ?? 0,
        outstanding_amount: v.outstanding_amount ?? 0,
        payment_count: pay.count,
        payment_progress_pct: paymentProgress,
        requisition_count: r.count,
        delivery_rate_pct: deliveryRate,
        tds_records: tg.tds,
        gst_records: tg.gst,
        tds_gst_pending: tg.pending,
      };
    });

    res.json({ data: enriched, total: enriched.length });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchVendorPerformance error:", err);
    res.status(500).json({ error: "Failed to fetch vendor performance report" });
  }
});

// GET /api/reports/material-consumption
reportsRouter.get("/material-consumption", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: categories } = await supabaseServer
      .from("material_categories")
      .select("name")
      .order("name", { ascending: true });

    const { data: inventory } = await supabaseServer
      .from("inventory_items")
      .select("id, name, category, unit, current_stock, minimum_stock");
    const inventoryByCategory: Record<string, { items: number; low_stock: number }> = {};
    (inventory ?? []).forEach((i: any) => {
      const cat = i.category ?? "Uncategorised";
      if (!inventoryByCategory[cat]) inventoryByCategory[cat] = { items: 0, low_stock: 0 };
      inventoryByCategory[cat].items++;
      if (
        i.minimum_stock != null &&
        i.current_stock != null &&
        i.current_stock <= i.minimum_stock
      ) {
        inventoryByCategory[cat].low_stock++;
      }
    });

    const { data: batches } = await supabaseServer.from("batches").select("material, status");
    const batchByMaterial: Record<string, { total: number; verified: number }> = {};
    (batches ?? []).forEach((b: any) => {
      const mat = b.material ?? "Unknown";
      if (!batchByMaterial[mat]) batchByMaterial[mat] = { total: 0, verified: 0 };
      batchByMaterial[mat].total++;
      if (b.status === "Verified") batchByMaterial[mat].verified++;
    });

    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select("block, amount, stage");
    const reqByBlock: Record<string, { count: number; amount: number }> = {};
    (requisitions ?? []).forEach((r: any) => {
      const block = r.block ?? "Unassigned";
      if (!reqByBlock[block]) reqByBlock[block] = { count: 0, amount: 0 };
      reqByBlock[block].count++;
      reqByBlock[block].amount += r.amount ?? 0;
    });

    const { data: transactions } = await supabaseServer
      .from("inventory_transactions")
      .select("type, quantity");
    const txnSummary = { received: 0, issued: 0, adjusted: 0 };
    (transactions ?? []).forEach((t: any) => {
      const qty = Math.abs(t.quantity ?? 0);
      if (t.type === "IN" || t.type === "Receipt") txnSummary.received += qty;
      else if (t.type === "OUT" || t.type === "Issue") txnSummary.issued += qty;
      else txnSummary.adjusted += qty;
    });

    res.json({
      categories: (categories ?? []).map((c: any) => ({
        name: c.name,
        inventory_items: inventoryByCategory[c.name]?.items ?? 0,
        low_stock_items: inventoryByCategory[c.name]?.low_stock ?? 0,
      })),
      batch_by_material: Object.entries(batchByMaterial).map(([material, info]) => ({
        material,
        total_batches: info.total,
        verified_batches: info.verified,
        verification_pct: info.total > 0 ? Math.round((info.verified / info.total) * 100) : 0,
      })),
      procurement_by_block: Object.entries(reqByBlock).map(([block, info]) => ({
        block,
        requisition_count: info.count,
        total_amount: info.amount,
      })),
      inventory_txn_summary: txnSummary,
      total_inventory_items: inventory?.length ?? 0,
      total_batches: batches?.length ?? 0,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchMaterialConsumption error:", err);
    res.status(500).json({ error: "Failed to fetch material consumption report" });
  }
});

// GET /api/reports/labour-productivity
reportsRouter.get("/labour-productivity", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: labour } = await supabaseServer
      .from("labour")
      .select("id, trade, contractor, planned, present, block, date")
      .order("date", { ascending: false });

    const tradeMap: Record<
      string,
      { entries: number; total_planned: number; total_present: number; blocks: Set<string> }
    > = {};
    (labour ?? []).forEach((l: any) => {
      const trade = l.trade ?? "Unknown";
      if (!tradeMap[trade])
        tradeMap[trade] = { entries: 0, total_planned: 0, total_present: 0, blocks: new Set() };
      tradeMap[trade].entries++;
      tradeMap[trade].total_planned += l.planned ?? 0;
      tradeMap[trade].total_present += l.present ?? 0;
      if (l.block) tradeMap[trade].blocks.add(l.block);
    });

    const tradeSummary = Object.entries(tradeMap).map(([trade, info]) => ({
      trade,
      entries: info.entries,
      total_planned: info.total_planned,
      total_present: info.total_present,
      avg_attendance: info.entries > 0 ? Math.round(info.total_present / info.entries) : 0,
      productivity_pct:
        info.total_planned > 0 ? Math.round((info.total_present / info.total_planned) * 100) : 0,
      blocks: Array.from(info.blocks),
    }));

    const blockMap: Record<
      string,
      { entries: number; total_planned: number; total_present: number }
    > = {};
    (labour ?? []).forEach((l: any) => {
      const block = l.block ?? "Unassigned";
      if (!blockMap[block]) blockMap[block] = { entries: 0, total_planned: 0, total_present: 0 };
      blockMap[block].entries++;
      blockMap[block].total_planned += l.planned ?? 0;
      blockMap[block].total_present += l.present ?? 0;
    });

    const blockSummary = Object.entries(blockMap).map(([block, info]) => ({
      block,
      entries: info.entries,
      total_planned: info.total_planned,
      total_present: info.total_present,
      productivity_pct:
        info.total_planned > 0 ? Math.round((info.total_present / info.total_planned) * 100) : 0,
    }));

    const contractorMap: Record<
      string,
      { entries: number; total_planned: number; total_present: number }
    > = {};
    (labour ?? []).forEach((l: any) => {
      const contractor = l.contractor ?? "Unknown";
      if (!contractorMap[contractor])
        contractorMap[contractor] = { entries: 0, total_planned: 0, total_present: 0 };
      contractorMap[contractor].entries++;
      contractorMap[contractor].total_planned += l.planned ?? 0;
      contractorMap[contractor].total_present += l.present ?? 0;
    });

    const contractorSummary = Object.entries(contractorMap).map(([contractor, info]) => ({
      contractor,
      entries: info.entries,
      total_planned: info.total_planned,
      total_present: info.total_present,
      productivity_pct:
        info.total_planned > 0 ? Math.round((info.total_present / info.total_planned) * 100) : 0,
    }));

    const totalPlanned = (labour ?? []).reduce((s, l: any) => s + (l.planned ?? 0), 0);
    const totalPresent = (labour ?? []).reduce((s, l: any) => s + (l.present ?? 0), 0);

    res.json({
      trade_summary: tradeSummary,
      block_summary: blockSummary,
      contractor_summary: contractorSummary,
      overall: {
        total_entries: labour?.length ?? 0,
        total_planned: totalPlanned,
        total_present: totalPresent,
        overall_productivity_pct:
          totalPlanned > 0 ? Math.round((totalPresent / totalPlanned) * 100) : 0,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchLabourProductivity error:", err);
    res.status(500).json({ error: "Failed to fetch labour productivity report" });
  }
});

// GET /api/reports/compliance
reportsRouter.get("/compliance", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: inspections } = await supabaseServer.from("inspections").select("result");
    const qcPass = (inspections ?? []).filter((i: any) => i.result === "Pass").length;
    const qcFail = (inspections ?? []).filter((i: any) => i.result === "Fail").length;
    const qcReinspect = (inspections ?? []).filter((i: any) => i.result === "Re-inspection").length;

    const { data: batches } = await supabaseServer.from("batches").select("status");
    const batchVerified = (batches ?? []).filter((b: any) => b.status === "Verified").length;
    const batchTotal = batches?.length ?? 0;

    res.json({
      quality: {
        pass: qcPass,
        fail: qcFail,
        re_inspection: qcReinspect,
        total: inspections?.length ?? 0,
        pass_rate:
          (inspections?.length ?? 0) > 0
            ? Math.round((qcPass / (inspections?.length ?? 1)) * 100)
            : 0,
      },
      traceability: {
        verified: batchVerified,
        total: batchTotal,
        verification_pct: batchTotal > 0 ? Math.round((batchVerified / batchTotal) * 100) : 0,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchComplianceStatus error:", err);
    res.status(500).json({ error: "Failed to fetch compliance report" });
  }
});
