import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches a paginated list of visitor log entries ordered by most recent check-in.
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

// Fetches a paginated list of vehicle log entries ordered by most recent entry.
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

// Fetches a paginated list of labour attendance records, optionally filtered by date.
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

// Zod schema validating visitor check-in fields (name, org, purpose, host).
const visitorSchema = z.object({
  name: z.string().min(1),
  org: z.string().optional(),
  purpose: z.string().optional(),
  host: z.string().optional(),
});

// Creates a new visitor check-in entry and logs the action to the audit trail.
export const createVisitor = createServerFn({ method: "POST" })
  .validator(visitorSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: visitor, error } = await supabaseServer
      .from("visitors")
      .insert(data)
      .select("id, name")
      .single();

    if (error || !visitor) {
      return { success: false, error: "Failed to check in visitor" };
    }

    await logAction(user, "create_visitor", "visitor", visitor.id, { name: visitor.name });
    return { success: true, id: visitor.id };
  });

// Zod schema validating vehicle entry fields (number, type, driver, material).
const vehicleSchema = z.object({
  number: z.string().min(1),
  type: z.string().optional(),
  driver: z.string().optional(),
  material: z.string().optional(),
});

// Creates a new vehicle entry log and logs the action to the audit trail.
export const createVehicle = createServerFn({ method: "POST" })
  .validator(vehicleSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: vehicle, error } = await supabaseServer
      .from("vehicles")
      .insert(data)
      .select("id, number")
      .single();

    if (error || !vehicle) {
      return { success: false, error: "Failed to log vehicle entry" };
    }

    await logAction(user, "create_vehicle", "vehicle", vehicle.id, { number: vehicle.number });
    return { success: true, id: vehicle.id };
  });

// Zod schema validating labour attendance fields (trade, contractor, counts, block, date).
const labourSchema = z.object({
  trade: z.string().min(1),
  contractor: z.string().optional(),
  planned: z.number().int().min(0).default(0),
  present: z.number().int().min(0).default(0),
  block: z.string().optional(),
  date: z.string().optional(),
});

// Creates a new labour attendance record and logs the action to the audit trail.
export const createLabour = createServerFn({ method: "POST" })
  .validator(labourSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: labour, error } = await supabaseServer
      .from("labour")
      .insert(data)
      .select("id, trade")
      .single();

    if (error || !labour) {
      return { success: false, error: "Failed to record labour attendance" };
    }

    await logAction(user, "create_labour", "labour", labour.id, { trade: labour.trade });
    return { success: true, id: labour.id };
  });

// Checks out a visitor by recording the exit timestamp (only if not already checked out).
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

// Checks out a vehicle by recording the exit timestamp (only if not already checked out).
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
