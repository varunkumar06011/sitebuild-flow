import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";

// ============================================================================
// Reports API — aggregates data from all existing modules for analytics.
// All functions are read-only and return summary data for reporting.
// ============================================================================

// (a) Project Status Report — overall project health from all modules.
export const fetchProjectStatus = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();

    // Procurement: count requisitions by stage
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

    // Vendors: total committed and paid
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

    // Quality: inspection results
    const { data: inspections } = await supabaseServer.from("inspections").select("id, result");
    const qcPass = (inspections ?? []).filter((i: any) => i.result === "Pass").length;
    const qcFail = (inspections ?? []).filter((i: any) => i.result === "Fail").length;
    const qcReinspect = (inspections ?? []).filter((i: any) => i.result === "Re-inspection").length;

    // Gate passes
    const { data: gatePasses } = await supabaseServer.from("gate_passes").select("id, status");
    const gpActive = (gatePasses ?? []).filter(
      (g: any) => g.status === "Awaiting OTP" || g.status === "OTP Verified",
    ).length;
    const gpExited = (gatePasses ?? []).filter((g: any) => g.status === "Exited").length;

    // Batches
    const { data: batches } = await supabaseServer.from("batches").select("id, status");
    const batchVerified = (batches ?? []).filter((b: any) => b.status === "Verified").length;
    const batchPending = (batches ?? []).filter((b: any) => b.status === "Pending MTC").length;
    const batchTesting = (batches ?? []).filter((b: any) => b.status === "Under Test").length;

    // Budget
    const { data: budgets } = await supabaseServer.from("budgets").select("budgeted_amount");
    const totalBudget = (budgets ?? []).reduce((s, b: any) => s + (b.budgeted_amount ?? 0), 0);

    // NABH
    const { data: nabhItems } = await supabaseServer.from("nabh_checklist").select("id, status");
    const nabhCompleted = (nabhItems ?? []).filter((n: any) => n.status === "Completed").length;
    const nabhTotal = (nabhItems ?? []).length;

    // Medical equipment
    const { data: equipment } = await supabaseServer.from("medical_equipment").select("id, status");
    const eqCommissioned = (equipment ?? []).filter(
      (e: any) => e.status === "Commissioned" || e.status === "Handed Over",
    ).length;
    const eqTotal = (equipment ?? []).length;

    return {
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
      compliance: {
        nabh_completed: nabhCompleted,
        nabh_total: nabhTotal,
        nabh_pct: nabhTotal > 0 ? Math.round((nabhCompleted / nabhTotal) * 100) : 0,
        equipment_commissioned: eqCommissioned,
        equipment_total: eqTotal,
      },
    };
  });

// (b) Vendor Performance Report — per-vendor metrics.
export const fetchVendorPerformance = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();

    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select(
        "id, name, gst_number, total_amount, amount_paid, outstanding_amount, status, materials_purchased",
      )
      .order("total_amount", { ascending: false });

    // Payment count per vendor
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

    // Requisitions per vendor
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

    // TDS/GST records per vendor
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
      const req = reqMap[v.id] ?? { count: 0, delivered: 0 };
      const tg = tdsGstMap[v.id] ?? { tds: 0, gst: 0, pending: 0 };
      const paymentProgress =
        v.total_amount > 0 ? Math.round((v.amount_paid / v.total_amount) * 100) : 0;
      const deliveryRate = req.count > 0 ? Math.round((req.delivered / req.count) * 100) : 0;
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
        requisition_count: req.count,
        delivery_rate_pct: deliveryRate,
        tds_records: tg.tds,
        gst_records: tg.gst,
        tds_gst_pending: tg.pending,
      };
    });

    return { data: enriched, total: enriched.length };
  });

// (c) Material Consumption Report — material categories with procurement and inventory data.
export const fetchMaterialConsumption = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();

    // Material categories
    const { data: categories } = await supabaseServer
      .from("material_categories")
      .select("name")
      .order("name", { ascending: true });

    // Inventory items with stock
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

    // Batches by material
    const { data: batches } = await supabaseServer.from("batches").select("material, status");
    const batchByMaterial: Record<string, { total: number; verified: number }> = {};
    (batches ?? []).forEach((b: any) => {
      const mat = b.material ?? "Unknown";
      if (!batchByMaterial[mat]) batchByMaterial[mat] = { total: 0, verified: 0 };
      batchByMaterial[mat].total++;
      if (b.status === "Verified") batchByMaterial[mat].verified++;
    });

    // Requisitions by block
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

    // Inventory transactions (issues vs receipts)
    const { data: transactions } = await supabaseServer
      .from("inventory_transactions")
      .select("type, quantity");
    const txnSummary = {
      received: 0,
      issued: 0,
      adjusted: 0,
    };
    (transactions ?? []).forEach((t: any) => {
      const qty = Math.abs(t.quantity ?? 0);
      if (t.type === "IN" || t.type === "Receipt") txnSummary.received += qty;
      else if (t.type === "OUT" || t.type === "Issue") txnSummary.issued += qty;
      else txnSummary.adjusted += qty;
    });

    return {
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
    };
  });

// (d) Labour Productivity Report — trade-wise attendance and productivity.
export const fetchLabourProductivity = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();

    const { data: labour } = await supabaseServer
      .from("labour")
      .select("id, trade, contractor, planned, present, block, date")
      .order("date", { ascending: false });

    // Trade-wise summary
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

    // Block-wise summary
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

    // Contractor summary
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

    return {
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
    };
  });

// (e) Compliance Status Report — NABH, AERB, QC, cleanroom, medical gas, equipment.
export const fetchComplianceStatus = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();

    // NABH by category
    const { data: nabhItems } = await supabaseServer
      .from("nabh_checklist")
      .select("category, status");
    const nabhByCategory: Record<
      string,
      { total: number; completed: number; in_progress: number; pending: number }
    > = {};
    (nabhItems ?? []).forEach((n: any) => {
      const cat = n.category ?? "Uncategorised";
      if (!nabhByCategory[cat])
        nabhByCategory[cat] = { total: 0, completed: 0, in_progress: 0, pending: 0 };
      nabhByCategory[cat].total++;
      if (n.status === "Completed") nabhByCategory[cat].completed++;
      else if (n.status === "In Progress") nabhByCategory[cat].in_progress++;
      else if (n.status === "Pending") nabhByCategory[cat].pending++;
    });

    // AERB
    const { data: aerb } = await supabaseServer
      .from("aerb_compliance")
      .select("result, license_expiry");
    const aerbPass = (aerb ?? []).filter((a: any) => a.result === "Pass").length;
    const aerbFail = (aerb ?? []).filter((a: any) => a.result === "Fail").length;
    const aerbRetest = (aerb ?? []).filter((a: any) => a.result === "Re-test").length;
    const now = new Date();
    const aerbExpiring = (aerb ?? []).filter((a: any) => {
      if (!a.license_expiry) return false;
      const expiry = new Date(a.license_expiry);
      const days = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return days <= 90 && days >= 0;
    }).length;

    // Cleanroom
    const { data: cleanroom } = await supabaseServer.from("cleanroom_validation").select("result");
    const crPass = (cleanroom ?? []).filter((c: any) => c.result === "Pass").length;
    const crFail = (cleanroom ?? []).filter((c: any) => c.result === "Fail").length;
    const crRetest = (cleanroom ?? []).filter((c: any) => c.result === "Re-test").length;

    // Medical gas
    const { data: gas } = await supabaseServer
      .from("medical_gas_pipeline")
      .select(
        "pressure_test_result, leak_test_result, manifold_installed, cross_connection_verified",
      );
    const gasAllClear = (gas ?? []).filter(
      (g: any) =>
        g.pressure_test_result === "Pass" &&
        g.leak_test_result === "Pass" &&
        g.manifold_installed &&
        g.cross_connection_verified,
    ).length;
    const gasPending = (gas ?? []).filter(
      (g: any) => g.pressure_test_result === "Pending" || g.leak_test_result === "Pending",
    ).length;

    // Medical equipment
    const { data: equipment } = await supabaseServer.from("medical_equipment").select("status");
    const eqByStatus: Record<string, number> = {};
    (equipment ?? []).forEach((e: any) => {
      const s = e.status ?? "Unknown";
      eqByStatus[s] = (eqByStatus[s] ?? 0) + 1;
    });

    // QC inspections
    const { data: inspections } = await supabaseServer.from("inspections").select("result");
    const qcPass = (inspections ?? []).filter((i: any) => i.result === "Pass").length;
    const qcFail = (inspections ?? []).filter((i: any) => i.result === "Fail").length;
    const qcReinspect = (inspections ?? []).filter((i: any) => i.result === "Re-inspection").length;

    // Batches (traceability compliance)
    const { data: batches } = await supabaseServer.from("batches").select("status");
    const batchVerified = (batches ?? []).filter((b: any) => b.status === "Verified").length;
    const batchTotal = batches?.length ?? 0;

    return {
      nabh: {
        by_category: Object.entries(nabhByCategory).map(([category, info]) => ({
          category,
          total: info.total,
          completed: info.completed,
          in_progress: info.in_progress,
          pending: info.pending,
          completion_pct: info.total > 0 ? Math.round((info.completed / info.total) * 100) : 0,
        })),
        total: nabhItems?.length ?? 0,
        completed: (nabhItems ?? []).filter((n: any) => n.status === "Completed").length,
        overall_pct:
          (nabhItems?.length ?? 0) > 0
            ? Math.round(
                ((nabhItems ?? []).filter((n: any) => n.status === "Completed").length /
                  (nabhItems?.length ?? 1)) *
                  100,
              )
            : 0,
      },
      aerb: {
        pass: aerbPass,
        fail: aerbFail,
        re_test: aerbRetest,
        total: aerb?.length ?? 0,
        licenses_expiring: aerbExpiring,
      },
      cleanroom: {
        pass: crPass,
        fail: crFail,
        re_test: crRetest,
        total: cleanroom?.length ?? 0,
        pass_rate:
          (cleanroom?.length ?? 0) > 0 ? Math.round((crPass / (cleanroom?.length ?? 1)) * 100) : 0,
      },
      medical_gas: {
        all_clear: gasAllClear,
        pending_tests: gasPending,
        total: gas?.length ?? 0,
      },
      medical_equipment: {
        by_status: eqByStatus,
        total: equipment?.length ?? 0,
        commissioned: (equipment ?? []).filter(
          (e: any) => e.status === "Commissioned" || e.status === "Handed Over",
        ).length,
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
      traceability: {
        verified: batchVerified,
        total: batchTotal,
        verification_pct: batchTotal > 0 ? Math.round((batchVerified / batchTotal) * 100) : 0,
      },
    };
  });
