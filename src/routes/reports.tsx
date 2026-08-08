// Reports & Analytics — 5 report types with CSV export: project status, vendor performance,
// material consumption, labour productivity, and compliance status.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  fetchProjectStatus,
  fetchVendorPerformance,
  fetchMaterialConsumption,
  fetchLabourProductivity,
  fetchComplianceStatus,
} from "@/lib/api/reports";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Building2,
  Package,
  HardHat,
  ShieldCheck,
  Download,
  IndianRupee,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Printer,
} from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — Meditrust ERP" },
      {
        name: "description",
        content:
          "Project status, vendor performance, material consumption, labour productivity and compliance status reports with CSV export.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: ReportsPage,
});

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Converts an array of objects to CSV and triggers a download.
function exportCSV(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) {
    toast.error("No data to export");
    return;
  }
  const firstRow = rows[0] ?? {};
  const headers = Object.keys(firstRow);
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val == null) return "";
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        })
        .join(","),
    ),
  ];
  const csv = csvLines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} rows to ${filename}.csv`);
}

// Main reports page with 5 tabs.
function ReportsPage() {
  return (
    <AppShell
      title="Reports & analytics"
      subtitle="Project-wide reporting with CSV export and print"
    >
      <div className="mb-4 flex justify-end print:hidden">
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 size-4" /> Print / PDF
        </Button>
      </div>
      <Tabs defaultValue="project-status" className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap gap-1">
          <TabsTrigger value="project-status" className="gap-1.5">
            <LayoutDashboard className="size-3.5" /> Project Status
          </TabsTrigger>
          <TabsTrigger value="vendor-performance" className="gap-1.5">
            <Building2 className="size-3.5" /> Vendor Performance
          </TabsTrigger>
          <TabsTrigger value="material-consumption" className="gap-1.5">
            <Package className="size-3.5" /> Material Consumption
          </TabsTrigger>
          <TabsTrigger value="labour-productivity" className="gap-1.5">
            <HardHat className="size-3.5" /> Labour Productivity
          </TabsTrigger>
          <TabsTrigger value="compliance-status" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Compliance Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="project-status">
          <ProjectStatusReport />
        </TabsContent>
        <TabsContent value="vendor-performance">
          <VendorPerformanceReport />
        </TabsContent>
        <TabsContent value="material-consumption">
          <MaterialConsumptionReport />
        </TabsContent>
        <TabsContent value="labour-productivity">
          <LabourProductivityReport />
        </TabsContent>
        <TabsContent value="compliance-status">
          <ComplianceStatusReport />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// ============================================================================
// (a) Project Status Report
// ============================================================================

function ProjectStatusReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-project-status"],
    queryFn: () => fetchProjectStatus({ data: {} }),
  });
  const r = data as any;

  if (isLoading)
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading report...</Card>;
  if (!r)
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">No data available.</Card>
    );

  const exportData = [
    { metric: "Total Requisitions", value: r.procurement.total_requisitions },
    { metric: "Total Procurement Amount", value: `₹${formatINR(r.procurement.total_amount)}` },
    { metric: "Total Budget", value: `₹${formatINR(r.finance.total_budget)}` },
    { metric: "Total Committed", value: `₹${formatINR(r.finance.total_committed)}` },
    { metric: "Total Paid", value: `₹${formatINR(r.finance.total_paid)}` },
    { metric: "Total Outstanding", value: `₹${formatINR(r.finance.total_outstanding)}` },
    { metric: "Budget Utilisation %", value: `${r.finance.budget_utilisation_pct}%` },
    { metric: "Active Vendors", value: r.finance.active_vendors },
    { metric: "QC Pass", value: r.quality.pass },
    { metric: "QC Fail", value: r.quality.fail },
    { metric: "QC Pass Rate %", value: `${r.quality.pass_rate}%` },
    { metric: "Gate Pass Active", value: r.gate_pass.active },
    { metric: "Gate Pass Exited", value: r.gate_pass.exited },
    { metric: "Batches Verified", value: r.traceability.verified },
    { metric: "Batches Pending MTC", value: r.traceability.pending_mtc },
    {
      metric: "NABH Completed",
      value: `${r.compliance.nabh_completed}/${r.compliance.nabh_total}`,
    },
    { metric: "NABH %", value: `${r.compliance.nabh_pct}%` },
    {
      metric: "Equipment Commissioned",
      value: `${r.compliance.equipment_commissioned}/${r.compliance.equipment_total}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => exportCSV("project-status", exportData)}>
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<IndianRupee className="size-4" />}
          label="Total budget"
          value={`₹${formatINR(r.finance.total_budget)}`}
        />
        <SummaryCard
          icon={<TrendingDown className="size-4" />}
          label="Committed"
          value={`₹${formatINR(r.finance.total_committed)}`}
          sub={`${r.finance.budget_utilisation_pct}% utilised`}
        />
        <SummaryCard
          icon={<CheckCircle2 className="size-4" />}
          label="Paid"
          value={`₹${formatINR(r.finance.total_paid)}`}
          sub={`₹${formatINR(r.finance.total_outstanding)} outstanding`}
        />
        <SummaryCard
          icon={<Building2 className="size-4" />}
          label="Active vendors"
          value={r.finance.active_vendors}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 font-semibold">Procurement pipeline</p>
          <div className="space-y-2">
            {Object.entries(r.procurement.by_stage).map(([stage, info]: [string, any]) => (
              <div key={stage} className="flex items-center justify-between text-sm">
                <span>{stage}</span>
                <span className="font-medium">
                  {info.count}{" "}
                  <span className="text-xs text-muted-foreground">· ₹{formatINR(info.amount)}</span>
                </span>
              </div>
            ))}
            {Object.keys(r.procurement.by_stage).length === 0 && (
              <p className="text-sm text-muted-foreground">No requisitions yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Quality control</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-success">{r.quality.pass}</p>
              <p className="text-xs text-muted-foreground">Pass</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-destructive">{r.quality.fail}</p>
              <p className="text-xs text-muted-foreground">Fail</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-warning">{r.quality.re_inspection}</p>
              <p className="text-xs text-muted-foreground">Re-inspect</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Pass rate</span>
              <span className="font-medium">{r.quality.pass_rate}%</span>
            </div>
            <Progress value={r.quality.pass_rate} className="h-2" />
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Material traceability</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-success">{r.traceability.verified}</p>
              <p className="text-xs text-muted-foreground">Verified</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-warning">{r.traceability.under_test}</p>
              <p className="text-xs text-muted-foreground">Testing</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-destructive">{r.traceability.pending_mtc}</p>
              <p className="text-xs text-muted-foreground">Pending MTC</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Compliance & equipment</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>NABH compliance</span>
              <span className="font-medium">
                {r.compliance.nabh_completed}/{r.compliance.nabh_total} ({r.compliance.nabh_pct}%)
              </span>
            </div>
            <Progress value={r.compliance.nabh_pct} className="h-1.5" />
            <div className="flex items-center justify-between pt-2">
              <span>Equipment commissioned</span>
              <span className="font-medium">
                {r.compliance.equipment_commissioned}/{r.compliance.equipment_total}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// (b) Vendor Performance Report
// ============================================================================

function VendorPerformanceReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-vendor-performance"],
    queryFn: () => fetchVendorPerformance({ data: {} }),
  });
  const vendors = (data?.data ?? []) as any[];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            exportCSV(
              "vendor-performance",
              vendors.map((v) => ({
                vendor: v.name,
                gst: v.gst_number ?? "",
                status: v.status,
                total_amount: v.total_amount,
                amount_paid: v.amount_paid,
                outstanding: v.outstanding_amount,
                payment_progress_pct: v.payment_progress_pct,
                requisitions: v.requisition_count,
                delivery_rate_pct: v.delivery_rate_pct,
                tds_records: v.tds_records,
                gst_records: v.gst_records,
                tds_gst_pending: v.tds_gst_pending,
              })),
            )
          }
        >
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 text-right font-medium">Total ₹</th>
                <th className="px-4 py-3 text-right font-medium">Paid ₹</th>
                <th className="px-4 py-3 text-right font-medium">Outstanding ₹</th>
                <th className="px-4 py-3 font-medium">Pay Progress</th>
                <th className="px-4 py-3 text-right font-medium">Requisitions</th>
                <th className="px-4 py-3 font-medium">Delivery Rate</th>
                <th className="px-4 py-3 text-right font-medium">TDS/GST Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendors.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {isLoading ? "Loading..." : "No vendor data available."}
                  </td>
                </tr>
              )}
              {vendors.map((v: any) => (
                <tr key={v.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{v.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.materials_purchased ?? v.gst_number ?? "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">₹{formatINR(v.total_amount)}</td>
                  <td className="px-4 py-3 text-right text-success">₹{formatINR(v.amount_paid)}</td>
                  <td className="px-4 py-3 text-right font-medium text-destructive">
                    ₹{formatINR(v.outstanding_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Progress value={v.payment_progress_pct} className="h-1.5 w-20" />
                      <span className="text-xs text-muted-foreground">
                        {v.payment_progress_pct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">{v.requisition_count}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${v.delivery_rate_pct >= 80 ? "text-success" : v.delivery_rate_pct >= 50 ? "text-warning" : "text-destructive"}`}
                    >
                      {v.delivery_rate_pct}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.tds_gst_pending > 0 ? (
                      <span className="font-medium text-warning">{v.tds_gst_pending}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// (c) Material Consumption Report
// ============================================================================

function MaterialConsumptionReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-material-consumption"],
    queryFn: () => fetchMaterialConsumption({ data: {} }),
  });
  const r = data as any;

  if (isLoading)
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading report...</Card>;
  if (!r)
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">No data available.</Card>
    );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            exportCSV(
              "material-consumption",
              r.categories.map((c: any) => ({
                category: c.name,
                inventory_items: c.inventory_items,
                low_stock_items: c.low_stock_items,
              })),
            )
          }
        >
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={<Package className="size-4" />}
          label="Inventory items"
          value={r.total_inventory_items}
        />
        <SummaryCard
          icon={<CheckCircle2 className="size-4" />}
          label="Material batches"
          value={r.total_batches}
        />
        <SummaryCard
          icon={<TrendingUp className="size-4" />}
          label="Stock received"
          value={formatINR(r.inventory_txn_summary.received)}
          sub={`Issued: ${formatINR(r.inventory_txn_summary.issued)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 font-semibold">Material categories — inventory & stock alerts</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">Items</th>
                  <th className="pb-2 text-right font-medium">Low stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.categories.map((c: any) => (
                  <tr key={c.name}>
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="py-2 text-right">{c.inventory_items}</td>
                    <td className="py-2 text-right">
                      {c.low_stock_items > 0 ? (
                        <span className="font-medium text-destructive">{c.low_stock_items}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Batch verification by material</p>
          <div className="space-y-2">
            {r.batch_by_material.slice(0, 10).map((b: any) => (
              <div key={b.material}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{b.material}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.verified_batches}/{b.total_batches} ({b.verification_pct}%)
                  </span>
                </div>
                <Progress value={b.verification_pct} className="h-1.5" />
              </div>
            ))}
            {r.batch_by_material.length === 0 && (
              <p className="text-sm text-muted-foreground">No batches registered.</p>
            )}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="mb-3 font-semibold">Procurement by block</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Block</th>
                  <th className="pb-2 text-right font-medium">Requisitions</th>
                  <th className="pb-2 text-right font-medium">Total amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.procurement_by_block.map((b: any) => (
                  <tr key={b.block}>
                    <td className="py-2 font-medium">{b.block}</td>
                    <td className="py-2 text-right">{b.requisition_count}</td>
                    <td className="py-2 text-right font-medium">₹{formatINR(b.total_amount)}</td>
                  </tr>
                ))}
                {r.procurement_by_block.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-muted-foreground">
                      No procurement data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// (d) Labour Productivity Report
// ============================================================================

function LabourProductivityReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-labour-productivity"],
    queryFn: () => fetchLabourProductivity({ data: {} }),
  });
  const r = data as any;

  if (isLoading)
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading report...</Card>;
  if (!r)
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">No data available.</Card>
    );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            exportCSV(
              "labour-productivity",
              r.trade_summary.map((t: any) => ({
                trade: t.trade,
                entries: t.entries,
                total_planned: t.total_planned,
                total_present: t.total_present,
                avg_attendance: t.avg_attendance,
                productivity_pct: t.productivity_pct,
                blocks: t.blocks.join("; "),
              })),
            )
          }
        >
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryCard
          icon={<HardHat className="size-4" />}
          label="Total entries"
          value={r.overall.total_entries}
        />
        <SummaryCard
          icon={<TrendingUp className="size-4" />}
          label="Total planned"
          value={r.overall.total_planned}
        />
        <SummaryCard
          icon={<CheckCircle2 className="size-4" />}
          label="Total present"
          value={r.overall.total_present}
        />
        <SummaryCard
          icon={<TrendingUp className="size-4" />}
          label="Overall productivity"
          value={`${r.overall.overall_productivity_pct}%`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 font-semibold">Trade-wise productivity</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Trade</th>
                  <th className="pb-2 text-right font-medium">Entries</th>
                  <th className="pb-2 text-right font-medium">Planned</th>
                  <th className="pb-2 text-right font-medium">Present</th>
                  <th className="pb-2 text-right font-medium">Productivity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.trade_summary.map((t: any) => (
                  <tr key={t.trade}>
                    <td className="py-2 font-medium">{t.trade}</td>
                    <td className="py-2 text-right">{t.entries}</td>
                    <td className="py-2 text-right">{t.total_planned}</td>
                    <td className="py-2 text-right">{t.total_present}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`font-medium ${t.productivity_pct >= 80 ? "text-success" : t.productivity_pct >= 60 ? "text-warning" : "text-destructive"}`}
                      >
                        {t.productivity_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
                {r.trade_summary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      No labour data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Block-wise productivity</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Block</th>
                  <th className="pb-2 text-right font-medium">Entries</th>
                  <th className="pb-2 text-right font-medium">Planned</th>
                  <th className="pb-2 text-right font-medium">Present</th>
                  <th className="pb-2 text-right font-medium">Productivity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.block_summary.map((b: any) => (
                  <tr key={b.block}>
                    <td className="py-2 font-medium">{b.block}</td>
                    <td className="py-2 text-right">{b.entries}</td>
                    <td className="py-2 text-right">{b.total_planned}</td>
                    <td className="py-2 text-right">{b.total_present}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`font-medium ${b.productivity_pct >= 80 ? "text-success" : b.productivity_pct >= 60 ? "text-warning" : "text-destructive"}`}
                      >
                        {b.productivity_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
                {r.block_summary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      No block data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="mb-3 font-semibold">Contractor-wise summary</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Contractor</th>
                  <th className="pb-2 text-right font-medium">Entries</th>
                  <th className="pb-2 text-right font-medium">Planned</th>
                  <th className="pb-2 text-right font-medium">Present</th>
                  <th className="pb-2 text-right font-medium">Productivity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.contractor_summary.map((c: any) => (
                  <tr key={c.contractor}>
                    <td className="py-2 font-medium">{c.contractor}</td>
                    <td className="py-2 text-right">{c.entries}</td>
                    <td className="py-2 text-right">{c.total_planned}</td>
                    <td className="py-2 text-right">{c.total_present}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`font-medium ${c.productivity_pct >= 80 ? "text-success" : c.productivity_pct >= 60 ? "text-warning" : "text-destructive"}`}
                      >
                        {c.productivity_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
                {r.contractor_summary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      No contractor data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// (e) Compliance Status Report
// ============================================================================

function ComplianceStatusReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-compliance-status"],
    queryFn: () => fetchComplianceStatus({ data: {} }),
  });
  const r = data as any;

  if (isLoading)
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading report...</Card>;
  if (!r)
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">No data available.</Card>
    );

  const exportData = [
    { module: "NABH", metric: "Total items", value: r.nabh.total },
    { module: "NABH", metric: "Completed", value: r.nabh.completed },
    { module: "NABH", metric: "Completion %", value: `${r.nabh.overall_pct}%` },
    { module: "AERB", metric: "Pass", value: r.aerb.pass },
    { module: "AERB", metric: "Fail", value: r.aerb.fail },
    { module: "AERB", metric: "Re-test", value: r.aerb.re_test },
    { module: "AERB", metric: "Licenses expiring", value: r.aerb.licenses_expiring },
    { module: "Cleanroom", metric: "Pass", value: r.cleanroom.pass },
    { module: "Cleanroom", metric: "Fail", value: r.cleanroom.fail },
    { module: "Cleanroom", metric: "Pass rate %", value: `${r.cleanroom.pass_rate}%` },
    { module: "Medical Gas", metric: "All clear", value: r.medical_gas.all_clear },
    { module: "Medical Gas", metric: "Pending tests", value: r.medical_gas.pending_tests },
    { module: "Medical Equipment", metric: "Total", value: r.medical_equipment.total },
    {
      module: "Medical Equipment",
      metric: "Commissioned",
      value: r.medical_equipment.commissioned,
    },
    { module: "Quality Control", metric: "Pass", value: r.quality.pass },
    { module: "Quality Control", metric: "Fail", value: r.quality.fail },
    { module: "Quality Control", metric: "Pass rate %", value: `${r.quality.pass_rate}%` },
    { module: "Traceability", metric: "Verified batches", value: r.traceability.verified },
    {
      module: "Traceability",
      metric: "Verification %",
      value: `${r.traceability.verification_pct}%`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportCSV("compliance-status", exportData)}
        >
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<ShieldCheck className="size-4" />}
          label="NABH compliance"
          value={`${r.nabh.overall_pct}%`}
          sub={`${r.nabh.completed}/${r.nabh.total} items`}
        />
        <SummaryCard
          icon={<CheckCircle2 className="size-4" />}
          label="QC pass rate"
          value={`${r.quality.pass_rate}%`}
          sub={`${r.quality.pass} pass / ${r.quality.fail} fail`}
        />
        <SummaryCard
          icon={<AlertCircle className="size-4" />}
          label="AERB licenses expiring"
          value={r.aerb.licenses_expiring}
          sub="within 90 days"
        />
        <SummaryCard
          icon={<Package className="size-4" />}
          label="Batch verification"
          value={`${r.traceability.verification_pct}%`}
          sub={`${r.traceability.verified}/${r.traceability.total} batches`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* NABH by category */}
        <Card className="p-5">
          <p className="mb-3 font-semibold">NABH compliance by category</p>
          <div className="space-y-3">
            {r.nabh.by_category.map((c: any) => (
              <div key={c.category}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{c.category}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.completed}/{c.total} ({c.completion_pct}%)
                  </span>
                </div>
                <Progress value={c.completion_pct} className="h-1.5" />
              </div>
            ))}
            {r.nabh.by_category.length === 0 && (
              <p className="text-sm text-muted-foreground">No NABH data.</p>
            )}
          </div>
        </Card>

        {/* AERB + Cleanroom + Gas */}
        <Card className="p-5">
          <p className="mb-3 font-semibold">AERB & radiation safety</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-success">{r.aerb.pass}</p>
              <p className="text-xs text-muted-foreground">Pass</p>
            </div>
            <div>
              <p className="text-xl font-bold text-destructive">{r.aerb.fail}</p>
              <p className="text-xs text-muted-foreground">Fail</p>
            </div>
            <div>
              <p className="text-xl font-bold text-warning">{r.aerb.re_test}</p>
              <p className="text-xs text-muted-foreground">Re-test</p>
            </div>
          </div>
          {r.aerb.licenses_expiring > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-warning">
              <AlertCircle className="size-3.5" /> {r.aerb.licenses_expiring} license(s) expiring
              within 90 days
            </p>
          )}
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Cleanroom & HVAC validation</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-success">{r.cleanroom.pass}</p>
              <p className="text-xs text-muted-foreground">Pass</p>
            </div>
            <div>
              <p className="text-xl font-bold text-destructive">{r.cleanroom.fail}</p>
              <p className="text-xs text-muted-foreground">Fail</p>
            </div>
            <div>
              <p className="text-xl font-bold text-warning">{r.cleanroom.re_test}</p>
              <p className="text-xs text-muted-foreground">Re-test</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Pass rate</span>
              <span className="font-medium">{r.cleanroom.pass_rate}%</span>
            </div>
            <Progress value={r.cleanroom.pass_rate} className="h-1.5" />
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Medical gas pipeline</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-success">{r.medical_gas.all_clear}</p>
              <p className="text-xs text-muted-foreground">All clear</p>
            </div>
            <div>
              <p className="text-xl font-bold text-warning">{r.medical_gas.pending_tests}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div>
              <p className="text-xl font-bold">{r.medical_gas.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Medical equipment commissioning</p>
          <div className="space-y-2 text-sm">
            {Object.entries(r.medical_equipment.by_status).map(([status, count]: [string, any]) => (
              <div key={status} className="flex items-center justify-between">
                <span>{status}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
            {Object.keys(r.medical_equipment.by_status).length === 0 && (
              <p className="text-sm text-muted-foreground">No equipment data.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <p className="mb-3 font-semibold">Quality control summary</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-success">{r.quality.pass}</p>
              <p className="text-xs text-muted-foreground">Pass</p>
            </div>
            <div>
              <p className="text-xl font-bold text-destructive">{r.quality.fail}</p>
              <p className="text-xs text-muted-foreground">Fail</p>
            </div>
            <div>
              <p className="text-xl font-bold text-warning">{r.quality.re_inspection}</p>
              <p className="text-xs text-muted-foreground">Re-inspect</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Shared components
// ============================================================================

function SummaryCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}
