import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import { verifyFirebasePhoneToken, normalizePhone } from "../firebase-verify";
import { checkRateLimit, getClientIp } from "../rate-limiter";

// Shape of a gate pass row returned to the client, with joined names and material details.
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
  person_name: string | null;
  vehicle_type: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  material_movement: boolean;
  material_list: { name: string; qty: string }[];
  remarks: string | null;
  photo_proof_path: string | null;
  gp_date: string | null;
  gp_time: string | null;
  batch_id: string | null;
  requisition_id: string | null;
};

// Fetches a paginated list of gate passes with requester, approver, and vendor names joined.
export const fetchGatePasses = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page?: number;
      limit?: number;
      status?: string;
      requestedBy?: string;
      search?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("gate_passes")
      .select(
        "id, gp_number, material, qty, carrier, vehicle, type, status, approver_phone, otp_channel, requested_by, requested_at, exit_time, approved_by, vendor_id, from_location, to_location, invoice_number, invoice_value, purpose, pdf_path, person_name, vehicle_type, driver_name, driver_mobile, material_movement, material_list, remarks, photo_proof_path, gp_date, gp_time, batch_id, requisition_id",
        { count: "exact" },
      )
      .order("requested_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.requestedBy) query = query.eq("requested_by", data.requestedBy);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`gp_number.ilike.%${s}%,person_name.ilike.%${s}%,material.ilike.%${s}%`);
      }
    }

    const { data: passes, count } = await query;

    const userIds = [
      ...new Set([
        ...(passes ?? []).map((p: any) => p.requested_by).filter(Boolean),
        ...(passes ?? []).map((p: any) => p.approved_by).filter(Boolean),
      ]),
    ];
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
        approved_by_name: p.approved_by ? (userMap.get(p.approved_by) ?? null) : null,
        vendor_id: p.vendor_id,
        vendor_name: p.vendor_id ? (vendorMap.get(p.vendor_id) ?? null) : null,
        from_location: p.from_location,
        to_location: p.to_location,
        invoice_number: p.invoice_number,
        invoice_value: p.invoice_value ? Number(p.invoice_value) : null,
        purpose: p.purpose,
        pdf_path: p.pdf_path,
        person_name: p.person_name,
        vehicle_type: p.vehicle_type,
        driver_name: p.driver_name,
        driver_mobile: p.driver_mobile,
        material_movement: p.material_movement ?? false,
        material_list: p.material_list ?? [],
        remarks: p.remarks,
        photo_proof_path: p.photo_proof_path,
        gp_date: p.gp_date,
        gp_time: p.gp_time,
        batch_id: p.batch_id ?? null,
        requisition_id: p.requisition_id ?? null,
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

// Zod schema validating gate pass creation fields (material, carrier, approver, vendor).
const createSchema = z.object({
  material: z.string().optional(),
  qty: z.string().optional(),
  carrier: z.string().optional(),
  vehicle: z.string().optional(),
  type: z.enum(["Returnable", "Non-returnable"]).default("Non-returnable"),
  approver_phone: z.string().min(1),
  vendor_id: z.string().uuid().nullable().optional(),
  from_location: z.string().optional(),
  to_location: z.string().optional(),
  invoice_number: z.string().optional(),
  invoice_value: z.number().optional(),
  purpose: z.string().optional(),
  person_name: z.string().min(1),
  vehicle_type: z.string().optional(),
  driver_name: z.string().optional(),
  driver_mobile: z.string().optional(),
  material_movement: z.boolean().default(false),
  material_list: z.array(z.object({ name: z.string(), qty: z.string() })).default([]),
  remarks: z.string().optional(),
  photo_proof_path: z.string().nullable().optional(),
  gp_date: z.string().optional(),
  gp_time: z.string().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  requisition_id: z.string().uuid().nullable().optional(),
});

// Creates a new gate pass with an auto-generated GP number and logs the action.
export const createGatePass = createServerFn({ method: "POST" })
  .validator(createSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: seqResult, error: seqError } = await supabaseServer.rpc("next_gp_number");

    if (seqError || !seqResult) {
      return { success: false, error: "Failed to generate gate pass number" };
    }

    const gpNumber = seqResult as string;

    const { data: gp, error } = await supabaseServer
      .from("gate_passes")
      .insert({
        gp_number: gpNumber,
        material:
          data.material ??
          (data.material_list.length > 0
            ? data.material_list
                .map((m: { name: string; qty: string }) => `${m.name} (${m.qty})`)
                .join(", ")
            : "—"),
        qty: data.qty ?? "—",
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
        person_name: data.person_name,
        vehicle_type: data.vehicle_type ?? null,
        driver_name: data.driver_name ?? null,
        driver_mobile: data.driver_mobile ?? null,
        material_movement: data.material_movement,
        material_list: data.material_list,
        remarks: data.remarks ?? null,
        photo_proof_path: data.photo_proof_path ?? null,
        gp_date: data.gp_date ?? new Date().toISOString().split("T")[0],
        gp_time: data.gp_time ?? new Date().toTimeString().split(" ")[0],
        batch_id: data.batch_id ?? null,
        requisition_id: data.requisition_id ?? null,
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

// Rate limit for OTP sends: 5 per minute per IP, 3 per 10 minutes per gate pass.
const OTP_IP_LIMIT = { maxRequests: 5, windowMs: 60 * 1000 };
const OTP_GP_LIMIT = { maxRequests: 3, windowMs: 10 * 60 * 1000 };

const precheckOtpSendSchema = z.object({ gatePassId: z.string().uuid() });

// Pre-checks whether an OTP send is allowed (rate limit + gate pass state).
// The client must call this before triggering Firebase Phone Auth SMS.
export const precheckOtpSend = createServerFn({ method: "POST" })
  .validator(precheckOtpSendSchema)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select("id, status, approver_phone")
      .eq("id", data.gatePassId)
      .single();

    if (!gp) return { allowed: false, error: "Gate pass not found" };
    if (gp.status !== "Awaiting OTP")
      return { allowed: false, error: "OTP already verified or pass exited" };
    if (!gp.approver_phone)
      return { allowed: false, error: "No approver phone set on this gate pass" };

    const ip = getClientIp();
    const ipResult = checkRateLimit(
      `otp:ip:${ip}`,
      OTP_IP_LIMIT.maxRequests,
      OTP_IP_LIMIT.windowMs,
    );
    if (!ipResult.allowed) {
      return { allowed: false, error: "Too many OTP requests from your IP. Please wait a minute." };
    }

    const gpResult = checkRateLimit(
      `otp:gp:${data.gatePassId}`,
      OTP_GP_LIMIT.maxRequests,
      OTP_GP_LIMIT.windowMs,
    );
    if (!gpResult.allowed) {
      return {
        allowed: false,
        error: "Too many OTP sends for this gate pass. Please wait 10 minutes.",
      };
    }

    return { allowed: true, phone: gp.approver_phone };
  });

const verifyPhoneOtpSchema = z.object({
  gatePassId: z.string().uuid(),
  idToken: z.string().min(1),
});

// Verifies a Firebase Phone-Auth ID token, checks the verified phone matches the
// approver (who must be an Administrator/A1/A1+), and marks the gate pass as
// "OTP Verified". The OTP SMS itself is sent client-side via Firebase Phone Auth.
export const verifyPhoneOtp = createServerFn({ method: "POST" })
  .validator(verifyPhoneOtpSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, status, approver_phone")
      .eq("id", data.gatePassId)
      .single();

    if (!gp) return { success: false, error: "Gate pass not found" };
    if (gp.status !== "Awaiting OTP")
      return { success: false, error: "Gate pass is not awaiting OTP" };

    const projectId = process.env["VITE_FIREBASE_PROJECT_ID"];
    if (!projectId) return { success: false, error: "Firebase project not configured" };

    let tokenPhone: string;
    try {
      const payload = await verifyFirebasePhoneToken(data.idToken, projectId);
      tokenPhone = payload.phone_number;
    } catch (e) {
      return { success: false, error: (e as Error).message ?? "Invalid Firebase token" };
    }

    if (normalizePhone(tokenPhone) !== normalizePhone(gp.approver_phone)) {
      await logAction(user, "otp_failed", "gate_pass", gp.id, {
        gp_number: gp.gp_number,
        reason: "phone_mismatch",
        token_phone: tokenPhone,
        approver_phone: gp.approver_phone,
      });
      return {
        success: false,
        error: "Verified phone does not match the approver for this gate pass",
      };
    }

    // Verify the approver phone belongs to an authorized role (Administrator/A1/A1+).
    const { data: approver } = await supabaseServer
      .from("users")
      .select("id, role")
      .in("role", ["Administrator", "A1", "A1+"])
      .filter("phone", "eq", gp.approver_phone)
      .limit(1)
      .maybeSingle();

    if (!approver) {
      await logAction(user, "otp_failed", "gate_pass", gp.id, {
        gp_number: gp.gp_number,
        reason: "approver_not_authorized",
        approver_phone: gp.approver_phone,
      });
      return {
        success: false,
        error: "The approver phone is not registered to an authorized admin (Administrator/A1/A1+)",
      };
    }

    await supabaseServer
      .from("gate_passes")
      .update({
        status: "OTP Verified",
        otp_channel: "sms",
        approved_by: approver.id,
      })
      .eq("id", data.gatePassId);

    await logAction(user, "otp_verified", "gate_pass", gp.id, {
      gp_number: gp.gp_number,
      phone: tokenPhone,
      approved_by_role: approver.role,
    });

    return { success: true };
  });

const recordExitSchema = z.object({ gatePassId: z.string().uuid() });

// Marks a gate pass as "Exited" with a timestamp once OTP is verified.
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
    if (gp.status !== "OTP Verified")
      return { success: false, error: "Gate pass must be OTP Verified before exit" };

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

// Fetches the audit-log timeline (actions, users, timestamps) for a single gate pass.
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

// Generates a time-limited signed URL for a gate pass PDF stored in Supabase.
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

    const { data: urlData, error } = await supabaseServer.storage
      .from("documents")
      .createSignedUrl(gp.pdf_path, 72 * 60 * 60);

    if (error || !urlData) {
      return { success: false, error: "Failed to generate signed URL" };
    }

    await logAction(user, "view_pdf", "gate_pass", data.gatePassId, { path: gp.pdf_path });

    return { success: true, url: urlData.signedUrl };
  });

// ---------------------------------------------------------------------------
// Fetch admin contacts for OTP approval flow (Administrators, A1, A1+)
// ---------------------------------------------------------------------------
export const fetchAdminContacts = createServerFn({ method: "GET" })
  .validator((input: { search?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("users")
      .select("id, name, role, phone")
      .in("role", ["Administrator", "A1", "A1+"])
      .order("name", { ascending: true });

    if (data.search) {
      query = query.or(`name.ilike.%${data.search}%,phone.ilike.%${data.search}%`);
    }

    const { data: admins } = await query;

    return {
      data: (admins ?? []).map((a: any) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        phone: a.phone ?? "",
      })),
    };
  });

// ---------------------------------------------------------------------------
// Fetch a single gate pass by ID (for print preview)
// ---------------------------------------------------------------------------
export const fetchGatePassById = createServerFn({ method: "GET" })
  .validator((input: { gatePassId: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: gp } = await supabaseServer
      .from("gate_passes")
      .select(
        "id, gp_number, material, qty, carrier, vehicle, type, status, approver_phone, otp_channel, requested_by, requested_at, exit_time, approved_by, vendor_id, from_location, to_location, invoice_number, invoice_value, purpose, pdf_path, person_name, vehicle_type, driver_name, driver_mobile, material_movement, material_list, remarks, photo_proof_path, gp_date, gp_time, batch_id, requisition_id",
      )
      .eq("id", data.gatePassId)
      .single();

    if (!gp) return { success: false, error: "Gate pass not found" };

    const userIds = [gp.requested_by, gp.approved_by].filter(Boolean);
    const vendorIds = gp.vendor_id ? [gp.vendor_id] : [];

    const [{ data: users }, { data: vendors }, { data: batch }, { data: requisition }] =
      await Promise.all([
        userIds.length > 0
          ? supabaseServer.from("users").select("id, name").in("id", userIds)
          : Promise.resolve({ data: [], error: null }),
        vendorIds.length > 0
          ? supabaseServer.from("vendors").select("id, name").in("id", vendorIds)
          : Promise.resolve({ data: [], error: null }),
        gp.batch_id
          ? supabaseServer
              .from("batches")
              .select(
                "id, batch_number, material, supplier, manufacturer, purchase_date, invoice, challan, mtc, lab_report, status",
              )
              .eq("id", gp.batch_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
        gp.requisition_id
          ? supabaseServer
              .from("requisitions")
              .select("id, pr_number, po_number, title, stage, vendor_id, amount")
              .eq("id", gp.requisition_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));
    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    let photoUrl: string | null = null;
    if (gp.photo_proof_path) {
      const { data: urlData } = await supabaseServer.storage
        .from("photos")
        .createSignedUrl(gp.photo_proof_path, 60 * 60);
      photoUrl = urlData?.signedUrl ?? null;
    }

    return {
      success: true,
      data: {
        id: gp.id,
        gp_number: gp.gp_number,
        material: gp.material,
        qty: gp.qty,
        carrier: gp.carrier,
        vehicle: gp.vehicle,
        type: gp.type,
        status: gp.status,
        approver_phone: gp.approver_phone,
        otp_channel: gp.otp_channel,
        requested_by: gp.requested_by,
        requested_by_name: userMap.get(gp.requested_by) ?? null,
        requested_at: gp.requested_at,
        exit_time: gp.exit_time,
        approved_by: gp.approved_by,
        approved_by_name: gp.approved_by ? (userMap.get(gp.approved_by) ?? null) : null,
        vendor_id: gp.vendor_id,
        vendor_name: gp.vendor_id ? (vendorMap.get(gp.vendor_id) ?? null) : null,
        from_location: gp.from_location,
        to_location: gp.to_location,
        invoice_number: gp.invoice_number,
        invoice_value: gp.invoice_value ? Number(gp.invoice_value) : null,
        purpose: gp.purpose,
        pdf_path: gp.pdf_path,
        person_name: gp.person_name,
        vehicle_type: gp.vehicle_type,
        driver_name: gp.driver_name,
        driver_mobile: gp.driver_mobile,
        material_movement: gp.material_movement ?? false,
        material_list: gp.material_list ?? [],
        remarks: gp.remarks,
        photo_proof_path: gp.photo_proof_path,
        photo_url: photoUrl,
        gp_date: gp.gp_date,
        gp_time: gp.gp_time,
        batch_id: gp.batch_id ?? null,
        requisition_id: gp.requisition_id ?? null,
        batch: batch
          ? {
              batch_number: batch.batch_number,
              material: batch.material,
              supplier: batch.supplier,
              manufacturer: batch.manufacturer,
              purchase_date: batch.purchase_date,
              invoice: batch.invoice,
              challan: batch.challan,
              mtc: batch.mtc,
              lab_report: batch.lab_report,
              status: batch.status,
            }
          : null,
        requisition: requisition
          ? {
              pr_number: requisition.pr_number,
              po_number: requisition.po_number ?? null,
              title: requisition.title,
              stage: requisition.stage,
              amount: Number(requisition.amount),
              vendor_name: requisition.vendor_id
                ? (vendorMap.get(requisition.vendor_id) ?? null)
                : null,
            }
          : null,
      } as GatePassRow & { photo_url: string | null; batch: any; requisition: any },
    };
  });
