import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import { approverFor, canApprove, type Stage } from "../erp-data";

export type RequisitionRow = {
  id: string;
  pr_number: string;
  title: string;
  block: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number;
  stage: Stage;
  raised_by: string;
  raised_by_name: string | null;
  date: string;
  quotations: any[];
  documents: any[];
};

export const fetchRequisitions = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; stage?: string; raisedBy?: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("requisitions")
      .select("id, pr_number, title, block, vendor_id, amount, stage, raised_by, date, quotations, documents", { count: "exact" })
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.stage) query = query.eq("stage", data.stage);
    if (data.raisedBy) query = query.eq("raised_by", data.raisedBy);

    const { data: reqs, count } = await query;

    const vendorIds = [...new Set((reqs ?? []).map((r: any) => r.vendor_id).filter(Boolean))];
    const userIds = [...new Set((reqs ?? []).map((r: any) => r.raised_by).filter(Boolean))];

    const [{ data: vendors }, { data: users }] = await Promise.all([
      vendorIds.length > 0
        ? supabaseServer.from("vendors").select("id, name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length > 0
        ? supabaseServer.from("users").select("id, name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    return {
      data: (reqs ?? []).map((r: any): RequisitionRow => ({
        id: r.id,
        pr_number: r.pr_number,
        title: r.title,
        block: r.block,
        vendor_id: r.vendor_id,
        vendor_name: r.vendor_id ? vendorMap.get(r.vendor_id) ?? null : null,
        amount: Number(r.amount),
        stage: r.stage as Stage,
        raised_by: r.raised_by,
        raised_by_name: userMap.get(r.raised_by) ?? null,
        date: r.date,
        quotations: r.quotations ?? [],
        documents: r.documents ?? [],
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

const createSchema = z.object({
  title: z.string().min(1),
  block: z.string().min(1),
  vendor_id: z.string().uuid().nullable(),
  amount: z.number().positive(),
  quotations: z.array(z.object({
    vendor: z.string(),
    amount: z.number(),
    selected: z.boolean(),
  })).default([]),
  documents: z.array(z.string()).default([]),
});

export const createRequisition = createServerFn({ method: "POST" })
  .validator(createSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const prNumber = `PR-${Math.floor(2000 + Math.random() * 999)}`;

    const { data: req, error } = await supabaseServer
      .from("requisitions")
      .insert({
        pr_number: prNumber,
        title: data.title,
        block: data.block,
        vendor_id: data.vendor_id,
        amount: data.amount,
        stage: "PR",
        raised_by: user.id,
        quotations: data.quotations,
        documents: data.documents,
      })
      .select("id, pr_number")
      .single();

    if (error || !req) {
      return { success: false, error: "Failed to create requisition" };
    }

    await logAction(user, "create_requisition", "requisition", req.id, { pr_number: req.pr_number, title: data.title, amount: data.amount });

    return { success: true, id: req.id, pr_number: req.pr_number };
  });

const updateStageSchema = z.object({
  id: z.string().uuid(),
  newStage: z.string(),
  expectedStage: z.string(),
});

export const updateRequisitionStage = createServerFn({ method: "POST" })
  .validator(updateStageSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: req } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, amount, stage, title")
      .eq("id", data.id)
      .single();

    if (!req) {
      return { success: false, error: "Requisition not found" };
    }

    if (req.stage !== data.expectedStage) {
      return { success: false, error: "Requisition stage has changed. Please refresh." };
    }

    const amount = Number(req.amount);
    if (!canApprove(user.role, amount) && data.newStage !== "Completed") {
      return { success: false, error: `Your role (${user.role}) cannot approve requisitions of this amount` };
    }

    const { error } = await supabaseServer
      .from("requisitions")
      .update({ stage: data.newStage })
      .eq("id", data.id)
      .eq("stage", data.expectedStage);

    if (error) {
      return { success: false, error: "Failed to update — possibly already updated by another user" };
    }

    await logAction(user, "update_stage", "requisition", req.id, {
      pr_number: req.pr_number,
      from: data.expectedStage,
      to: data.newStage,
      amount,
    });

    return { success: true };
  });
