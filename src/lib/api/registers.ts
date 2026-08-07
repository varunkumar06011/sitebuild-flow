import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

export const fetchVisitors = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    const { data: visitors, count } = await supabaseServer
      .from("visitors")
      .select("id, name, org, purpose, in_time, out_time, host", { count: "exact" })
      .order("in_time", { ascending: false })
      .range(offset, offset + limit - 1);

    return { data: visitors ?? [], total: count ?? 0, page, limit };
  });

export const fetchVehicles = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    const { data: vehicles, count } = await supabaseServer
      .from("vehicles")
      .select("id, number, type, driver, material, in_time, out_time", { count: "exact" })
      .order("in_time", { ascending: false })
      .range(offset, offset + limit - 1);

    return { data: vehicles ?? [], total: count ?? 0, page, limit };
  });

export const fetchLabour = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; date?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("labour")
      .select("id, trade, contractor, planned, present, block, date", { count: "exact" })
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.date) query = query.eq("date", data.date);

    const { data: labour, count } = await query;

    return { data: labour ?? [], total: count ?? 0, page, limit };
  });

export const checkOutVisitor = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("visitors")
      .update({ out_time: new Date().toISOString() })
      .eq("id", data.id)
      .is("out_time", "null");

    if (error) return { success: false, error: "Failed to check out visitor" };

    await logAction(user, "checkout_visitor", "visitor", data.id, {});
    return { success: true };
  });

export const checkOutVehicle = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("vehicles")
      .update({ out_time: new Date().toISOString() })
      .eq("id", data.id)
      .is("out_time", "null");

    if (error) return { success: false, error: "Failed to check out vehicle" };

    await logAction(user, "checkout_vehicle", "vehicle", data.id, {});
    return { success: true };
  });
