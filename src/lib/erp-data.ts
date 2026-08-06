// Mock data for the Hospital Construction ERP prototype (UI-only, no backend).

export type Role = "Supervisor" | "Administrator" | "A1" | "A1+";

export const ROLES: Role[] = ["Supervisor", "Administrator", "A1", "A1+"];

export const ROLE_SUMMARY: Record<Role, { scope: string; cannot: string; limit: string }> = {
  Supervisor: {
    scope: "Executes site operations, raises PRs, uploads quotations, POs, receipts, invoices",
    cannot: "Approve quotations, POs or payments",
    limit: "No approval authority",
  },
  Administrator: {
    scope: "Reviews & approves within limit, manages vendors, finance, users, reports",
    cannot: "Override Head Admin (A1+) rules",
    limit: "Up to ₹50,000",
  },
  A1: {
    scope: "Approves above admin limit, overrides project decisions, organization reports",
    cannot: "Grant final authority above ₹5,00,000",
    limit: "₹50,001 – ₹5,00,000",
  },
  "A1+": {
    scope: "Final approval authority, full system control",
    cannot: "—",
    limit: "Above ₹5,00,000",
  },
};

export function approverFor(amount: number): Role {
  if (amount <= 50000) return "Administrator";
  if (amount <= 500000) return "A1";
  return "A1+";
}

export function canApprove(role: Role, amount: number): boolean {
  if (role === "Supervisor") return false;
  const need = approverFor(amount);
  if (role === "A1+") return true;
  if (role === "A1") return need !== "A1+";
  return need === "Administrator";
}

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const PROCUREMENT_STAGES = [
  "PR",
  "Quotation",
  "Admin",
  "A1",
  "PO",
  "Material Received",
  "Invoice",
  "Payment",
  "Completed",
] as const;
export type Stage = (typeof PROCUREMENT_STAGES)[number];

export type Requisition = {
  id: string;
  title: string;
  block: string;
  vendor: string;
  amount: number;
  stage: Stage;
  raisedBy: string;
  date: string;
  quotations: { vendor: string; amount: number; selected: boolean }[];
  documents: string[];
};

export const REQUISITIONS: Requisition[] = [
  {
    id: "PR-2041",
    title: "TMT Steel Fe550D — 24 T",
    block: "OT Block · Level 3",
    vendor: "Meenakshi Steels",
    amount: 1840000,
    stage: "A1",
    raisedBy: "R. Kannan",
    date: "04 Aug 2026",
    quotations: [
      { vendor: "Meenakshi Steels", amount: 1840000, selected: true },
      { vendor: "Sree Ganesh Metals", amount: 1892000, selected: false },
      { vendor: "Coastal Iron Co.", amount: 1935500, selected: false },
    ],
    documents: ["PR-2041.pdf", "Quote-MS-881.pdf", "Quote-SG-104.pdf"],
  },
  {
    id: "PR-2038",
    title: "Medical Gas Copper Pipeline — 400 m",
    block: "ICU Wing · Level 2",
    vendor: "Aeromed Systems",
    amount: 642000,
    stage: "PO",
    raisedBy: "S. Fernandes",
    date: "02 Aug 2026",
    quotations: [
      { vendor: "Aeromed Systems", amount: 642000, selected: true },
      { vendor: "Vitalflow Pvt Ltd", amount: 668000, selected: false },
    ],
    documents: ["PR-2038.pdf", "PO-7712.pdf"],
  },
  {
    id: "PR-2036",
    title: "Lead Lining Sheets — Radiology",
    block: "Diagnostics · Level 1",
    vendor: "Shield Radiation Products",
    amount: 386000,
    stage: "Material Received",
    raisedBy: "R. Kannan",
    date: "31 Jul 2026",
    quotations: [{ vendor: "Shield Radiation Products", amount: 386000, selected: true }],
    documents: ["PR-2036.pdf", "PO-7698.pdf", "DC-4471.pdf", "MTC-Pb-22.pdf"],
  },
  {
    id: "PR-2033",
    title: "Vitrified Anti-skid Flooring — 1,200 sqm",
    block: "OPD Block · Ground",
    vendor: "Nirmala Ceramics",
    amount: 48500,
    stage: "Admin",
    raisedBy: "P. Deshmukh",
    date: "30 Jul 2026",
    quotations: [
      { vendor: "Nirmala Ceramics", amount: 48500, selected: true },
      { vendor: "Tilecraft India", amount: 51200, selected: false },
    ],
    documents: ["PR-2033.pdf"],
  },
  {
    id: "PR-2029",
    title: "HVAC AHU Units (4 Nos) — Modular OT",
    block: "OT Block · Level 3",
    vendor: "Thermoline Engineers",
    amount: 2960000,
    stage: "Invoice",
    raisedBy: "S. Fernandes",
    date: "26 Jul 2026",
    quotations: [
      { vendor: "Thermoline Engineers", amount: 2960000, selected: true },
      { vendor: "Blue Arc Climate", amount: 3110000, selected: false },
    ],
    documents: ["PR-2029.pdf", "PO-7654.pdf", "INV-9921.pdf"],
  },
  {
    id: "PR-2024",
    title: "Fire-rated Doors (18 Nos)",
    block: "ICU Wing · Level 2",
    vendor: "Safeguard Doors",
    amount: 415000,
    stage: "Completed",
    raisedBy: "P. Deshmukh",
    date: "18 Jul 2026",
    quotations: [{ vendor: "Safeguard Doors", amount: 415000, selected: true }],
    documents: ["PR-2024.pdf", "PO-7601.pdf", "INV-9840.pdf", "PAY-3312.pdf"],
  },
];

export type GatePass = {
  id: string;
  material: string;
  qty: string;
  carrier: string;
  vehicle: string;
  type: "Returnable" | "Non-returnable";
  status: "Awaiting OTP" | "OTP Verified" | "Exited";
  otp: string;
  requestedAt: string;
  exitTime: string | null;
};

export const GATE_PASSES: GatePass[] = [
  {
    id: "GP-1188",
    material: "Scaffolding frames (surplus)",
    qty: "120 nos",
    carrier: "Ravi Transport",
    vehicle: "TN-09-CQ-4412",
    type: "Returnable",
    status: "Awaiting OTP",
    otp: "704128",
    requestedAt: "06 Aug · 09:12",
    exitTime: null,
  },
  {
    id: "GP-1187",
    material: "Empty cement bags",
    qty: "3 bundles",
    carrier: "Site Housekeeping",
    vehicle: "TN-07-BA-1180",
    type: "Non-returnable",
    status: "OTP Verified",
    otp: "331904",
    requestedAt: "06 Aug · 08:40",
    exitTime: null,
  },
  {
    id: "GP-1185",
    material: "Damaged AHU coil (RMA)",
    qty: "1 unit",
    carrier: "Thermoline Engineers",
    vehicle: "KA-05-MJ-7781",
    type: "Returnable",
    status: "Exited",
    otp: "882015",
    requestedAt: "05 Aug · 16:05",
    exitTime: "05 Aug · 17:22",
  },
];

export type Batch = {
  id: string;
  material: string;
  supplier: string;
  manufacturer: string;
  purchaseDate: string;
  invoice: string;
  challan: string;
  mtc: string;
  labReport: string;
  photos: number;
  status: "Verified" | "Pending MTC" | "Under Test";
};

export const BATCHES: Batch[] = [
  {
    id: "BCH-5521",
    material: "TMT Steel Fe550D 16mm",
    supplier: "Meenakshi Steels",
    manufacturer: "JSW Steel Ltd",
    purchaseDate: "04 Aug 2026",
    invoice: "INV-9955",
    challan: "DC-4488",
    mtc: "MTC-JSW-77321",
    labReport: "LAB-TN-1120 (Pass)",
    photos: 6,
    status: "Verified",
  },
  {
    id: "BCH-5518",
    material: "OPC 53 Grade Cement",
    supplier: "Southern Cement Depot",
    manufacturer: "UltraTech",
    purchaseDate: "02 Aug 2026",
    invoice: "INV-9940",
    challan: "DC-4471",
    mtc: "MTC-UT-55110",
    labReport: "LAB-TN-1114 (Pass)",
    photos: 4,
    status: "Verified",
  },
  {
    id: "BCH-5510",
    material: "Lead Sheet 2mm (Radiology)",
    supplier: "Shield Radiation Products",
    manufacturer: "Shield Metals",
    purchaseDate: "31 Jul 2026",
    invoice: "INV-9918",
    challan: "DC-4460",
    mtc: "Awaiting upload",
    labReport: "Sample sent 01 Aug",
    photos: 3,
    status: "Pending MTC",
  },
  {
    id: "BCH-5504",
    material: "M30 Ready Mix Concrete",
    supplier: "Coastal RMC",
    manufacturer: "Coastal RMC Plant 2",
    purchaseDate: "28 Jul 2026",
    invoice: "INV-9902",
    challan: "DC-4442",
    mtc: "MTC-CR-2201",
    labReport: "Cube test day-7 in progress",
    photos: 9,
    status: "Under Test",
  },
];

export type Inspection = {
  id: string;
  activity: string;
  location: string;
  inspector: string;
  date: string;
  result: "Pass" | "Fail" | "Re-inspection";
  checklist: { item: string; ok: boolean }[];
  rectification: string | null;
  photos: number;
};

export const INSPECTIONS: Inspection[] = [
  {
    id: "QC-3312",
    activity: "Slab reinforcement before pour",
    location: "OT Block · Level 3",
    inspector: "A. Iyer (QA/QC)",
    date: "05 Aug 2026",
    result: "Pass",
    checklist: [
      { item: "Bar diameter & spacing as per drawing", ok: true },
      { item: "Cover blocks placed at 1m grid", ok: true },
      { item: "Lap length ≥ 50d", ok: true },
      { item: "Shuttering alignment & props", ok: true },
    ],
    rectification: null,
    photos: 8,
  },
  {
    id: "QC-3309",
    activity: "Medical gas pipeline pressure test",
    location: "ICU Wing · Level 2",
    inspector: "M. Rahman (MEP)",
    date: "04 Aug 2026",
    result: "Fail",
    checklist: [
      { item: "Brazed joints nitrogen purged", ok: true },
      { item: "Holds 7 bar for 24 hrs", ok: false },
      { item: "Line labelling & colour coding", ok: true },
      { item: "Valve box accessibility", ok: false },
    ],
    rectification: "Re-braze joints J-14/J-15, relocate valve box. Due 08 Aug.",
    photos: 5,
  },
  {
    id: "QC-3301",
    activity: "Radiology lead lining continuity",
    location: "Diagnostics · Level 1",
    inspector: "A. Iyer (QA/QC)",
    date: "02 Aug 2026",
    result: "Re-inspection",
    checklist: [
      { item: "Overlap ≥ 10mm at all seams", ok: true },
      { item: "No pinholes on scan", ok: false },
      { item: "Door frame shielding continuous", ok: true },
      { item: "Certificate matches batch", ok: true },
    ],
    rectification: "Patch 3 pinholes near duct penetration. Re-scan scheduled 07 Aug.",
    photos: 7,
  },
];

export const VISITORS = [
  { id: "V-8821", name: "Dr. Meera Nair", org: "Client — Medical Planning", purpose: "OT layout walkthrough", inTime: "09:05", outTime: "10:40", host: "S. Fernandes" },
  { id: "V-8822", name: "Anand Kulkarni", org: "Thermoline Engineers", purpose: "AHU installation survey", inTime: "10:20", outTime: null, host: "R. Kannan" },
  { id: "V-8823", name: "Insp. Devaraj", org: "Fire & Rescue Dept", purpose: "Statutory inspection", inTime: "11:15", outTime: null, host: "P. Deshmukh" },
];

export const VEHICLES = [
  { id: "VH-4471", number: "TN-09-CQ-4412", type: "Truck 16T", driver: "Ravi S.", material: "TMT Steel — 24 T", inTime: "07:48", outTime: "09:30" },
  { id: "VH-4472", number: "KA-05-MJ-7781", type: "Tempo", driver: "Imran K.", material: "AHU coil return", inTime: "08:15", outTime: null },
  { id: "VH-4473", number: "TN-22-AL-9002", type: "Transit Mixer", driver: "Suresh M.", material: "M30 RMC — 6 cum", inTime: "09:02", outTime: null },
];

export const LABOUR = [
  { trade: "Steel fixers", contractor: "Balaji Enterprises", planned: 42, present: 38, block: "OT Block" },
  { trade: "Masons", contractor: "Balaji Enterprises", planned: 30, present: 30, block: "OPD Block" },
  { trade: "MEP technicians", contractor: "Aeromed Systems", planned: 18, present: 14, block: "ICU Wing" },
  { trade: "Helpers", contractor: "Site Direct", planned: 55, present: 51, block: "All blocks" },
  { trade: "Safety marshals", contractor: "Site Direct", planned: 6, present: 6, block: "All blocks" },
];

export const PROGRESS = [
  { block: "OT Block", pct: 62 },
  { block: "ICU Wing", pct: 48 },
  { block: "OPD Block", pct: 81 },
  { block: "Diagnostics", pct: 35 },
];

export type NavRoute = {
  to: string;
  label: string;
  icon: string;
};

export const ROLE_NAV: Record<Role, NavRoute[]> = {
  Supervisor: [
    { to: "/supervisor", label: "My Dashboard", icon: "LayoutDashboard" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/gate-pass", label: "Gate Pass", icon: "ScanLine" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
  ],
  Administrator: [
    { to: "/administrator", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/approvals", label: "Approvals", icon: "ShieldCheck" },
    { to: "/gate-pass", label: "Gate Pass", icon: "ScanLine" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
  ],
  A1: [
    { to: "/a1", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/approvals", label: "Approvals", icon: "ShieldCheck" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
  ],
  "A1+": [
    { to: "/a1plus", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/approvals", label: "Approvals", icon: "ShieldCheck" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
  ],
};

export const ROLE_DASHBOARD_ROUTE: Record<Role, string> = {
  Supervisor: "/supervisor",
  Administrator: "/administrator",
  A1: "/a1",
  "A1+": "/a1plus",
};

export const ROLE_LOGIN_CREDENTIALS: Record<Role, { username: string; password: string }> = {
  Supervisor: { username: "supervisor", password: "site123" },
  Administrator: { username: "admin", password: "admin123" },
  A1: { username: "a1", password: "a1pass123" },
  "A1+": { username: "a1plus", password: "final123" },
};
