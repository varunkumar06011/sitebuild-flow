import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser, type SessionUser } from "./session";
import { logAction } from "./audit";
import { isFirebaseConfigured } from "../env-check";

export type GatePassRow = {
  id: string;
  gp_number: string;
  material: string;
  qty: string;
  carrier: string | null;
  vehicle: string | null;
  type: "Returnable" | "Non-returnable";
  status: "Awaiting OTP" | "OTP Verified" | "Exited";
  approver_phone: string | null;
  otp_channel: "sms" | "in_app" | null;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  exit_time: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  from_location: string | null;
  to_location: string | null;
  invoice_number: string | null;
  invoice_value: number | null;
  purpose: string | null;
  pdf_path: string | null;
};

export const fetchGatePasses = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; status?: string; requestedBy?: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("gate_passes")
      .select("id, gp_number, material, qty, carrier, vehicle, type, status, approver_phone, otp_channel, requested_by, requested_at, exit_time, approved_by, vendor_id, from_location, to_location, invoice_number, invoice_value, purpose, pdf_path", { count: "exact" })
      .order("requested_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.requestedBy) query = query.eq("requested_by", data.requestedBy);

    const { data: passes, count } = await query;

    const userIds = [...new Set([
      ...(passes ?? []).map((p: any) => p.requested_by).filter(Boolean),
      ...(passes ?? []).map((p: any) => p.approved_by).filter(Boolean),
    ])];
    const vendorIds = [...new Set((passes ?? []).map((p: any) => p.vendor_id).filter(Boolean))];

    const [{ data: users }, { data: vendors }] = await Promise.all([
      userIds.length > 0
        ? supabaseServer.from("users").select("id, name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      vendorIds.length > 0
        ? supabaseServer.from("vendors").select("id, name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));
    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    return {
      data: (passes ?? []).map((p: any): GatePassRow => ({
        id: p.id,
        gp_number: p.gp_number,
        material: p.material,
        qty: p.qty,
        carrier: p.carrier,
        vehicle: p.vehicle,
        type: p.type,
        status: p.status,
        approver_phone: p.approver_phone,
        otp_channel: p.otp_channel,
        requested_by: p.requested_by,
        requested_by_name: userMap.get(p.requested_by) ?? null,
        requested_at: p.requested_at,
        exit_time: p.exit_time,
        approved_by: p.approved_by,
        approved_by_name: p.approved_by ? userMap.get(p.approved_by) ?? null : null,
        vendor_id: p.vendor_id,
        vendor_name: p.vendor_id ? vendorMap.get(p.vendor_id) ?? null : null,
        from_location: p.from_location,
        to_location: p.to_location,
        invoice_number: p.invoice_number,
        invoice_value: p.invoice_value ? Number(p.invoice_value) : null,
        purpose: p.purpose,
        pdf_path: p.pdf_path,
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

const createSchema = z.object({
  material: z.string().min(1),
  qty: z.string().min(1),
  carrier: z.string().optional(),
  vehicle: z.string().optional(),
  type: z.enum(["Returnable", "Non-returnable"]),
  approver_phone: z.string().min(1),
  vendor_id: z.string().uuid().nullable().optional(),
  from_location: z.string().optional(),
  to_location: z.string().optional(),
  invoice_number: z.string().optional(),
  invoice_value: z.number().optional(),
  purpose: z.string().optional(),
});

export const createGatePass = createServerFn({ method: "POST" })
  .validator(createSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: seqResult, error: seqError } = await supabaseServer
      .rpc("next_gp_number");

    if (seqError || !seqResult) {
      return { success: false, error: "Failed to generate gate pass number" };
    }

    const gpNumber = seqResult as string;

    const { data: gp, error } = await supabaseServer
      .from("gate_passes")
      .insert({
        gp_number: gpNumber,
        material: data.material,
        qty: data.qty,
        carrier: data.carrier ?? null,
        vehicle: data.vehicle ?? null,
        type: data.type,
        status: "Awaiting OTP",
        approver_phone: data.approver_phone,
        requested_by: user.id,
        vendor_id: data.vendor_id ?? null,
        from_location: data.from_location ?? null,
        to_location: data.to_location ?? null,
        invoice_number: data.invoice_number ?? null,
        invoice_value: data.invoice_value ?? null,
        purpose: data.purpose ?? null,
      })
      .select("id, gp_number")
      .single();

    if (error || !gp) {
      return { success: false, error: "Failed to create gate pass" };
    }

    await logAction(user, "create_gate_pass", "gate_pass", gp.id, {
      gp_number: gp.gp_number,
      material: data.material,
    });

    return { success: true, id: gp.id, gp_number: gp.gp_number };
  });

const sendOtpSchema = z.object({ gatePassId: z.string().uuid() });

export const sendOtp = createServerFn({ method: "POST" })
  .validator(sendOtpSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, status, approver_phone")
      .eq("id", data.gatePassId)
      .single();

    if (!gp) return { success: false, error: "Gate pass not found" };
    if (gp.status !== "Awaiting OTP") return { success: false, error: "OTP already verified or pass exited" };

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const channel = isFirebaseConfigured() ? "sms" : "in_app";

    await supabaseServer
      .from("gate_passes")
      .update({
        otp_hash: otpHash,
        otp_expires_at: otpExpiresAt,
        otp_attempts: 0,
        otp_locked: false,
        otp_channel: channel,
      })
      .eq("id", data.gatePassId);

    if (channel === "in_app") {
      await supabaseServer.from("notifications").insert({
        user_id: user.id,
        type: "otp",
        title: `OTP for ${gp.gp_number}`,
        body: `Your OTP is ${otp}`,
        data: { gate_pass_id: data.gatePassId, gp_number: gp.gp_number },
      });
    }

    await logAction(user, "send_otp", "gate_pass", gp.id, {
      gp_number: gp.gp_number,
      channel,
      phone: gp.approver_phone,
    });

    return {
      success: true,
      channel,
      otp: channel === "in_app" ? otp : undefined,
      message: channel === "sms"
        ? `OTP sent to ${gp.approver_phone}`
        : "OTP sent via in-app notification (SMS not configured)",
    };
  });

const verifyOtpSchema = z.object({
  gatePassId: z.string().uuid(),
  otp: z.string().length(6),
});

export const verifyOtp = createServerFn({ method: "POST" })
  .validator(verifyOtpSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, status, otp_hash, otp_expires_at, otp_attempts, otp_locked")
      .eq("id", data.gatePassId)
      .single();

    if (!gp) return { success: false, error: "Gate pass not found" };
    if (gp.status !== "Awaiting OTP") return { success: false, error: "Gate pass is not awaiting OTP" };
    if (gp.otp_locked) return { success: false, error: "OTP locked due to too many attempts. Please resend." };

    const now = new Date();
    if (gp.otp_expires_at && new Date(gp.otp_expires_at) < now) {
      return { success: false, error: "OTP expired. Please resend." };
    }

    if (!gp.otp_hash) {
      return { success: false, error: "No OTP has been sent. Please send OTP first." };
    }

    const newAttempts = (gp.otp_attempts ?? 0) + 1;
    const match = await bcrypt.compare(data.otp, gp.otp_hash);

    if (!match) {
      const shouldLock = newAttempts >= 5;
      await supabaseServer
        .from("gate_passes")
        .update({
          otp_attempts: newAttempts,
          otp_locked: shouldLock,
        })
        .eq("id", data.gatePassId);

      await logAction(user, "otp_failed", "gate_pass", gp.id, {
        gp_number: gp.gp_number,
        attempts: newAttempts,
        locked: shouldLock,
      });

      if (shouldLock) {
        return { success: false, error: "Too many wrong attempts. OTP locked. Please resend." };
      }
      return { success: false, error: `Wrong OTP. ${5 - newAttempts} attempt(s) remaining.` };
    }

    await supabaseServer
      .from("gate_passes")
      .update({
        status: "OTP Verified",
        otp_hash: null,
        otp_attempts: 0,
        otp_locked: false,
        approved_by: user.id,
      })
      .eq("id", data.gatePassId);

    await logAction(user, "otp_verified", "gate_pass", gp.id, {
      gp_number: gp.gp_number,
    });

    return { success: true };
  });

const recordExitSchema = z.object({ gatePassId: z.string().uuid() });

export const recordExit = createServerFn({ method: "POST" })
  .validator(recordExitSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, status")
      .eq("id", data.gatePassId)
      .single();

    if (!gp) return { success: false, error: "Gate pass not found" };
    if (gp.status !== "OTP Verified") return { success: false, error: "Gate pass must be OTP Verified before exit" };

    const now = new Date().toISOString();

    const { error } = await supabaseServer
      .from("gate_passes")
      .update({ status: "Exited", exit_time: now })
      .eq("id", data.gatePassId)
      .eq("status", "OTP Verified");

    if (error) {
      return { success: false, error: "Failed to record exit — possibly already exited" };
    }

    await logAction(user, "record_exit", "gate_pass", gp.id, {
      gp_number: gp.gp_number,
      exit_time: now,
    });

    return { success: true, exit_time: now };
  });

export const fetchGatePassTimeline = createServerFn({ method: "GET" })
  .validator((input: { gatePassId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: logs } = await supabaseServer
      .from("audit_log")
      .select("action, created_at, user_id, details")
      .eq("entity_type", "gate_pass")
      .eq("entity_id", data.gatePassId)
      .order("created_at", { ascending: true });

    const userIds = [...new Set((logs ?? []).map((l: any) => l.user_id).filter(Boolean))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    return (logs ?? []).map((l: any) => ({
      action: l.action,
      created_at: l.created_at,
      user_name: userMap.get(l.user_id)?.name ?? "System",
      user_role: userMap.get(l.user_id)?.role ?? null,
      details: l.details,
    }));
  });

export const getGatePassSignedUrl = createServerFn({ method: "GET" })
  .validator((input: { gatePassId: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select("pdf_path")
      .eq("id", data.gatePassId)
      .single();

    if (!gp || !gp.pdf_path) {
      return { success: false, error: "No PDF available" };
    }

    const { data: urlData, error } = await supabaseServer
      .storage
      .from("documents")
      .createSignedUrl(gp.pdf_path, 72 * 60 * 60);

    if (error || !urlData) {
      return { success: false, error: "Failed to generate signed URL" };
    }

    await logAction(user, "view_pdf", "gate_pass", data.gatePassId, { path: gp.pdf_path });

    return { success: true, url: urlData.signedUrl };
  });
