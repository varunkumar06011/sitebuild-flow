// Reports — aggregated analytics across all ERP modules.
// Displays project status, vendor performance, material consumption, labour productivity, and compliance.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  fetchProjectStatus,
  fetchVendorPerformance,
  fetchMaterialConsumption,
  fetchLabourProductivity,
  fetchComplianceStatus,
} from "@/lib/api/reports-client";
import { inr } from "@/lib/erp-data";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Award,
  Package,
  HardHat,
  ShieldCheck,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — Meditrust ERP" },
      {
        name: "description",
        content:
          "Project status, vendor performance, material consumption, labour productivity, and compliance reports.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <AppShell
      title="Reports & Analytics"
      subtitle="Cross-module aggregated analytics for project health and compliance"
    >
      <Tabs defaultValue="project">
        <TabsList>
          <TabsTrigger value="project" className="gap-1.5">
            <LayoutDashboard className="size-3.5" /> Project Status
          </TabsTrigger>
          <TabsTrigger value="vendor" className="gap-1.5">
            <Award className="size-3.5" /> Vendor Performance
          </TabsTrigger>
          <TabsTrigger value="material" className="gap-1.5">
            <Package className="size-3.5" /> Material
          </TabsTrigger>
          <TabsTrigger value="labour" className="gap-1.5">
            <HardHat className="size-3.5" /> Labour
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="project">
          <ProjectStatusReport />
        </TabsContent>
        <TabsContent value="vendor">
          <VendorPerformanceReport />
        </TabsContent>
        <TabsContent value="material">
          <MaterialConsumptionReport />
        </TabsContent>
        <TabsContent value="labour">
          <LabourProductivityReport />
        </TabsContent>
        <TabsContent value="compliance">
          <ComplianceReport />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof TrendingUp;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneColors: Record<string, string> = {
    neutral: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning-foreground",
    danger: "text-destructive",
    info: "text-info",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex size-9 items-center justify-center rounded-lg bg-surface ${toneColors[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold">{value}</p>
      </div>
    </Card>
  );
}

function ProjectStatusReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-project-status"],
    queryFn: () => fetchProjectStatus(),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (!data) {
    toast.error("Failed to load project status");
    return null;
  }

  const ps = data.procurement;
  const fin = data.finance;
  const qc = data.quality;
  const gp = data.gate_pass;
  const trace = data.traceability;
  const comp = data.compliance;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Requisitions" value={ps.total_requisitions} icon={LayoutDashboard} tone="info" />
        <StatCard label="Total Procurement Value" value={inr(ps.total_amount)} icon={Wallet} tone="info" />
        <StatCard
          label="Budget Utilisation"
          value={`${fin.budget_utilisation_pct}%`}
          icon={fin.budget_utilisation_pct > 90 ? AlertTriangle : TrendingUp}
          tone={fin.budget_utilisation_pct > 90 ? "warning" : "success"}
        />
        <StatCard label="Outstanding Payments" value={inr(fin.total_outstanding)} icon={TrendingDown} tone="danger" />
      </div>

      <Card className="p-4">
        <p className="font-semibold">Procurement by Stage</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Count</th>
                <th className="px-3 py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(ps.by_stage).map(([stage, info]: any) => (
                <tr key={stage} className="hover:bg-surface/50">
                  <td className="px-3 py-2">
                    <StatusPill tone="info">{stage}</StatusPill>
                  </td>
                  <td className="px-3 py-2">{info.count}</td>
                  <td className="px-3 py-2 font-medium">{inr(info.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="font-semibold">Quality Control</p>
          <div className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pass Rate</span>
              <span className="font-semibold text-success">{qc.pass_rate}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Passed</span>
              <span className="text-success">{qc.pass}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Failed</span>
              <span className="text-destructive">{qc.fail}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Re-inspection</span>
              <span className="text-warning-foreground">{qc.re_inspection}</span>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <p className="font-semibold">Gate Pass</p>
          <div className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active</span>
              <span className="font-semibold">{gp.active}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Exited</span>
              <span>{gp.exited}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span>{gp.total}</span>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <p className="font-semibold">Traceability</p>
          <div className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verification Rate</span>
              <span className="font-semibold text-success">
                {trace.total > 0 ? Math.round((trace.verified / trace.total) * 100) : 0}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verified</span>
              <span className="text-success">{trace.verified}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pending MTC</span>
              <span className="text-warning-foreground">{trace.pending_mtc}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Under Test</span>
              <span>{trace.under_test}</span>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}

function VendorPerformanceReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-vendor-performance"],
    queryFn: () => fetchVendorPerformance(),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );

  const vendors = data?.data ?? [];

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Vendor Performance</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Payment progress, delivery rate, and TDS/GST status per vendor.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Total Amount</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Outstanding</th>
              <th className="px-4 py-3 font-medium">Payment %</th>
              <th className="px-4 py-3 font-medium">Requisitions</th>
              <th className="px-4 py-3 font-medium">Delivery %</th>
              <th className="px-4 py-3 font-medium">TDS/GST Pending</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {vendors.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  No vendor data available.
                </td>
              </tr>
            )}
            {vendors.map((v: any) => (
              <tr key={v.id} className="hover:bg-surface/50">
                <td className="px-4 py-3 font-medium">{v.name}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={v.status === "Active" ? "success" : "neutral"}>{v.status}</StatusPill>
                </td>
                <td className="px-4 py-3 text-xs">{inr(v.total_amount)}</td>
                <td className="px-4 py-3 text-xs">{inr(v.amount_paid)}</td>
                <td className="px-4 py-3 text-xs">{inr(v.outstanding_amount)}</td>
                <td className="px-4 py-3">
                  <span className={`font-semibold ${v.payment_progress_pct >= 75 ? "text-success" : v.payment_progress_pct >= 50 ? "text-warning-foreground" : "text-destructive"}`}>
                    {v.payment_progress_pct}%
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">{v.requisition_count}</td>
                <td className="px-4 py-3">
                  <span className={`font-semibold ${v.delivery_rate_pct >= 75 ? "text-success" : "text-warning-foreground"}`}>
                    {v.delivery_rate_pct}%
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {v.tds_gst_pending > 0 ? (
                    <StatusPill tone="warning">{v.tds_gst_pending} pending</StatusPill>
                  ) : (
                    <span className="text-success">All filed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MaterialConsumptionReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-material-consumption"],
    queryFn: () => fetchMaterialConsumption(),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );

  const d = data;
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Inventory Items" value={d.total_inventory_items} icon={Package} tone="info" />
        <StatCard label="Total Batches" value={d.total_batches} icon={Package} tone="info" />
        <StatCard label="Items Received" value={d.inventory_txn_summary.received} icon={TrendingUp} tone="success" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="font-semibold">Inventory by Category</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Items</th>
                  <th className="px-3 py-2 font-medium">Low Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.categories.map((c: any) => (
                  <tr key={c.name} className="hover:bg-surface/50">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">{c.inventory_items}</td>
                    <td className="px-3 py-2">
                      {c.low_stock_items > 0 ? (
                        <StatusPill tone="warning">{c.low_stock_items}</StatusPill>
                      ) : (
                        <span className="text-success">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <p className="font-semibold">Batch Verification by Material</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Verified</th>
                  <th className="px-3 py-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.batch_by_material.map((b: any) => (
                  <tr key={b.material} className="hover:bg-surface/50">
                    <td className="px-3 py-2 font-medium">{b.material}</td>
                    <td className="px-3 py-2">{b.total_batches}</td>
                    <td className="px-3 py-2 text-success">{b.verified_batches}</td>
                    <td className="px-3 py-2">
                      <span className={b.verification_pct >= 75 ? "text-success" : "text-warning-foreground"}>
                        {b.verification_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="font-semibold">Procurement by Block</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Block</th>
                <th className="px-3 py-2 font-medium">Requisitions</th>
                <th className="px-3 py-2 font-medium">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.procurement_by_block.map((b: any) => (
                <tr key={b.block} className="hover:bg-surface/50">
                  <td className="px-3 py-2 font-medium">{b.block}</td>
                  <td className="px-3 py-2">{b.requisition_count}</td>
                  <td className="px-3 py-2 font-medium">{inr(b.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function LabourProductivityReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-labour-productivity"],
    queryFn: () => fetchLabourProductivity(),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );

  const d = data;
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total Entries" value={d.overall.total_entries} icon={HardHat} tone="info" />
        <StatCard label="Total Planned" value={d.overall.total_planned} icon={HardHat} tone="neutral" />
        <StatCard label="Total Present" value={d.overall.total_present} icon={CheckCircle2} tone="success" />
        <StatCard
          label="Overall Productivity"
          value={`${d.overall.overall_productivity_pct}%`}
          icon={d.overall.overall_productivity_pct >= 75 ? TrendingUp : AlertTriangle}
          tone={d.overall.overall_productivity_pct >= 75 ? "success" : "warning"}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="font-semibold">By Trade</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Trade</th>
                  <th className="px-3 py-2 font-medium">Entries</th>
                  <th className="px-3 py-2 font-medium">Planned</th>
                  <th className="px-3 py-2 font-medium">Present</th>
                  <th className="px-3 py-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.trade_summary.map((t: any) => (
                  <tr key={t.trade} className="hover:bg-surface/50">
                    <td className="px-3 py-2 font-medium">{t.trade}</td>
                    <td className="px-3 py-2 text-xs">{t.entries}</td>
                    <td className="px-3 py-2 text-xs">{t.total_planned}</td>
                    <td className="px-3 py-2 text-xs">{t.total_present}</td>
                    <td className="px-3 py-2">
                      <span className={t.productivity_pct >= 75 ? "text-success" : "text-warning-foreground"}>
                        {t.productivity_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <p className="font-semibold">By Contractor</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Contractor</th>
                  <th className="px-3 py-2 font-medium">Entries</th>
                  <th className="px-3 py-2 font-medium">Planned</th>
                  <th className="px-3 py-2 font-medium">Present</th>
                  <th className="px-3 py-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.contractor_summary.map((c: any) => (
                  <tr key={c.contractor} className="hover:bg-surface/50">
                    <td className="px-3 py-2 font-medium">{c.contractor}</td>
                    <td className="px-3 py-2 text-xs">{c.entries}</td>
                    <td className="px-3 py-2 text-xs">{c.total_planned}</td>
                    <td className="px-3 py-2 text-xs">{c.total_present}</td>
                    <td className="px-3 py-2">
                      <span className={c.productivity_pct >= 75 ? "text-success" : "text-warning-foreground"}>
                        {c.productivity_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ComplianceReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-compliance"],
    queryFn: () => fetchComplianceStatus(),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );

  const d = data;
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="QC Pass Rate"
          value={`${d.quality.pass_rate}%`}
          icon={d.quality.pass_rate >= 75 ? CheckCircle2 : XCircle}
          tone={d.quality.pass_rate >= 75 ? "success" : "danger"}
        />
        <StatCard
          label="Traceability Verified"
          value={`${d.traceability.verification_pct}%`}
          icon={d.traceability.verification_pct >= 75 ? CheckCircle2 : AlertTriangle}
          tone={d.traceability.verification_pct >= 75 ? "success" : "warning"}
        />
      </div>
    </div>
  );
}
