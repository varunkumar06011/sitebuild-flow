import jsPDF from "jspdf";

type GatePassPdfData = {
  gp_number?: string | null;
  gp_date?: string | null;
  gp_time?: string | null;
  requested_at?: string | null;
  status?: string | null;
  type?: string | null;
  person_name?: string | null;
  purpose?: string | null;
  vehicle_type?: string | null;
  vehicle?: string | null;
  driver_name?: string | null;
  driver_mobile?: string | null;
  material?: string | null;
  qty?: string | null;
  material_movement?: boolean;
  material_list?: Array<{ name: string; qty: string }>;
  remarks?: string | null;
  approver_phone?: string | null;
  requested_by_name?: string | null;
  approved_by_name?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  invoice_number?: string | null;
  invoice_value?: number | null;
  vendor?: {
    name?: string | null;
    gst_number?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  organization?: {
    name?: string | null;
    gst_number?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  requisition?: {
    pr_number?: string | null;
    po_number?: string | null;
    title?: string | null;
    block?: string | null;
    stage?: string | null;
    amount?: number | null;
    invoice_number?: string | null;
    invoice_date?: string | null;
    invoice_amount?: number | null;
  } | null;
  batch?: {
    batch_number?: string | null;
    material?: string | null;
    supplier?: string | null;
    manufacturer?: string | null;
    purchase_date?: string | null;
    invoice?: string | null;
    challan?: string | null;
    mtc?: string | null;
    lab_report?: string | null;
    status?: string | null;
  } | null;
};

const value = (input: unknown) =>
  input === null || input === undefined || input === "" ? "—" : String(input);
const address = (place?: GatePassPdfData["organization"] | GatePassPdfData["vendor"] | null) =>
  place
    ? [place.address, place.city, place.state, place.pincode].filter(Boolean).join(", ") || "—"
    : "—";

export function downloadGatePassPdf(gp: GatePassPdfData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 16;
  const right = pageWidth - 16;
  let y = 18;

  const ensureSpace = (height: number) => {
    if (y + height > 280) {
      doc.addPage();
      y = 18;
    }
  };
  const wrapped = (text: string, width: number) => doc.splitTextToSize(text, width) as string[];
  const section = (title: string) => {
    ensureSpace(12);
    doc.setFillColor(237, 242, 247);
    doc.roundedRect(left, y, right - left, 8, 1.5, 1.5, "F");
    doc.setTextColor(31, 78, 121);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(title.toUpperCase(), left + 3, y + 5.3);
    y += 12;
    doc.setTextColor(35, 35, 35);
  };
  const row = (label: string, content: unknown, columns = 1) => {
    const width = (right - left - (columns - 1) * 8) / columns;
    const x = left + (rowIndex % columns) * (width + 8);
    const lines = wrapped(value(content), width);
    ensureSpace(Math.max(10, lines.length * 4 + 5));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 110, 120);
    doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(35, 35, 35);
    doc.text(lines, x, y + 4);
    if (columns === 1 || rowIndex % columns === columns - 1)
      y += Math.max(10, lines.length * 4 + 6);
    rowIndex += 1;
  };
  let rowIndex = 0;
  const rows = (items: Array<[string, unknown]>, columns = 2) => {
    rowIndex = 0;
    items.forEach(([label, content]) => row(label, content, columns));
    if (rowIndex % columns !== 0) y += 10;
  };

  const org = gp.organization;
  doc.setDrawColor(31, 78, 121);
  doc.setLineWidth(0.7);
  doc.line(left, 11, right, 11);
  doc.setTextColor(31, 78, 121);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(value(org?.name ?? "Meditrust Hospitals"), left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 100, 110);
  doc.text(address(org), left, y + 5);
  doc.text([org?.phone, org?.email].filter(Boolean).join("  |  "), left, y + 9);
  doc.setTextColor(35, 35, 35);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("GATE PASS", right, y + 1, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(value(gp.gp_number), right, y + 7, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Issued: ${value(gp.gp_date)} ${value(gp.gp_time)}`, right, y + 12, { align: "right" });
  y += 23;
  doc.setDrawColor(210, 218, 226);
  doc.line(left, y, right, y);
  y += 8;

  section("Pass status & approval");
  rows([
    ["Status", gp.status],
    ["Pass type", gp.type],
    ["Issued by", gp.requested_by_name],
    [
      "Approved by",
      gp.approved_by_name ?? (gp.status === "Awaiting OTP" ? "Pending OTP approval" : "—"),
    ],
    ["Approver mobile", gp.approver_phone],
    ["Created at", gp.requested_at ? new Date(gp.requested_at).toLocaleString("en-IN") : null],
  ]);

  section("Visitor & movement details");
  rows([
    ["Person / visitor", gp.person_name],
    ["Purpose", gp.purpose],
    ["Vehicle type", gp.vehicle_type],
    ["Vehicle number", gp.vehicle],
    ["Driver name", gp.driver_name],
    ["Driver mobile", gp.driver_mobile],
    ["From location", gp.from_location],
    ["To / site address", gp.to_location ?? address(org)],
  ]);

  section("Vendor & document references");
  rows([
    ["Vendor", gp.vendor?.name],
    ["Vendor GSTIN", gp.vendor?.gst_number],
    ["Vendor address", address(gp.vendor)],
    ["Vendor contact", [gp.vendor?.phone, gp.vendor?.email].filter(Boolean).join("  |  ")],
    ["PR number", gp.requisition?.pr_number],
    ["PO number", gp.requisition?.po_number],
    ["Invoice number", gp.invoice_number ?? gp.requisition?.invoice_number],
    ["Invoice value", gp.invoice_value ?? gp.requisition?.invoice_amount ?? gp.requisition?.amount],
    ["Procurement stage", gp.requisition?.stage],
    ["Project / block", gp.requisition?.block],
  ]);

  section("Material details");
  ensureSpace(18);
  doc.setFillColor(31, 78, 121);
  doc.rect(left, y, right - left, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("MATERIAL / DESCRIPTION", left + 3, y + 5.3);
  doc.text("QUANTITY", right - 3, y + 5.3, { align: "right" });
  y += 8;
  const materials = gp.material_list?.filter((item) => item.name.trim()) ?? [];
  const materialRows =
    materials.length > 0 ? materials : [{ name: value(gp.material), qty: value(gp.qty) }];
  materialRows.forEach((item) => {
    const lines = wrapped(value(item.name), right - left - 45);
    ensureSpace(Math.max(8, lines.length * 4 + 4));
    doc.setTextColor(35, 35, 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(lines, left + 3, y + 5);
    doc.text(value(item.qty), right - 3, y + 5, { align: "right" });
    doc.setDrawColor(225, 230, 235);
    doc.line(
      left,
      y + Math.max(8, lines.length * 4 + 2),
      right,
      y + Math.max(8, lines.length * 4 + 2),
    );
    y += Math.max(8, lines.length * 4 + 3);
  });
  y += 3;
  rows(
    [
      ["Material movement", gp.material_movement ? "Yes" : "No"],
      ["Remarks", gp.remarks],
    ],
    1,
  );

  if (gp.batch) {
    section("Traceability & receiving records");
    rows([
      ["Batch number", gp.batch.batch_number],
      ["Batch material", gp.batch.material],
      ["Supplier", gp.batch.supplier],
      ["Manufacturer", gp.batch.manufacturer],
      ["Purchase date", gp.batch.purchase_date],
      ["Batch invoice", gp.batch.invoice],
      ["Challan", gp.batch.challan],
      ["MTC / Lab report", [gp.batch.mtc, gp.batch.lab_report].filter(Boolean).join("  |  ")],
    ]);
  }

  ensureSpace(32);
  y += 4;
  doc.setDrawColor(110, 120, 130);
  doc.setFontSize(8);
  doc.setTextColor(90, 100, 110);
  doc.line(left, y + 14, left + 50, y + 14);
  doc.line(right - 50, y + 14, right, y + 14);
  doc.text("Authorized issuer", left, y + 19);
  doc.text("Approver signature", right, y + 19, { align: "right" });
  doc.setFontSize(7);
  doc.text(
    "This gate pass is generated at creation and remains subject to the approval status shown above.",
    left,
    y + 27,
  );
  doc.save(`${value(gp.gp_number).replace(/[^a-z0-9-_]/gi, "-")}-gate-pass.pdf`);
}
