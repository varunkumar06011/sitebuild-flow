// Client Portal Dashboard — read-only project visibility for the hospital client/consultant.
// Shows project progress, budget vs spend, QC pass rate, gate pass summary, and traceability.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { verifyPortalSession, logoutPortal, PORTAL_COOKIE } from "@/lib/api/portal-auth";
import {
  fetchClientDashboard,
  fetchClientProgress,
  fetchClientBudget,
  fetchClientQuality,
  fetchClientGatePass,
} from "@/lib/api/client-portal";
import { toast } from "sonner";
import {
  Eye,
  TrendingUp,
  IndianRupee,
  BadgeCheck,
  ScanLine,
  Boxes,
  Wallet,
  LogOut,
  Loader2,
  Package,
} from "lucide-react";

export const Route = createFileRoute("/portal/client/")({
  head: () => ({
    meta: [{ title: "Client Portal — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    try {
      const result = await verifyPortalSession();
      if (!result.authenticated || result.account?.account_type !== "client") {
        throw redirect({ to: "/portal/client/login" });
      }
    } catch (err: any) {
      if (err?.status === 307 || err?.name === "RedirectError") throw err;
      throw redirect({ to: "/portal/client/login" });
    }
  },
  component: ClientPortalPage,
});

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function ClientPortalPage() {
  const { data: sessionData } = useQuery({
    queryKey: ["portal-session"],
    queryFn: () => verifyPortalSession() as any,
  });
  const account = sessionData?.account;

  const { data: dashData, isLoading } = useQuery({
    queryKey: ["client-dashboard"],
    queryFn: () => fetchClientDashboard(),
  });
  const dash = dashData?.data;

  const handleLogout = async () => {
    await logoutPortal();
    document.cookie = `${PORTAL_COOKIE}=; path=/; max-age=0`;
    window.location.href = "/portal/client/login";
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-border bg-emerald-700 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Eye className="size-6" />
            <div>
              <p className="font-bold">Client Portal</p>
              <p className="text-xs text-white/70">
                {account?.name ?? "Client"} — Vgrand Multi-speciality Hospital
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-white hover:bg-white/10"
          >
            <LogOut className="mr-1.5 size-4" /> Logout
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : dash ? (
          <>
            {/* Overview cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="size-4" />
                  <p className="text-xs font-medium">Overall Progress</p>
                </div>
                <p className="mt-2 text-3xl font-bold">{dash.progress.overall_progress_pct}%</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${dash.progress.overall_progress_pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dash.progress.completed_cells}/{dash.progress.total_cells} cells completed
                </p>
              </Card>

              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wallet className="size-4" />
                  <p className="text-xs font-medium">Budget Utilization</p>
                </div>
                <p className="mt-2 text-3xl font-bold">{dash.budget.utilization_pct}%</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ₹{formatINR(dash.budget.total_actual)} of ₹{formatINR(dash.budget.total_budget)}
                </p>
              </Card>

              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <BadgeCheck className="size-4" />
                  <p className="text-xs font-medium">QC Pass Rate</p>
                </div>
                <p className="mt-2 text-3xl font-bold">{dash.quality.pass_rate}%</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dash.quality.passed}/{dash.quality.total_inspections} inspections passed
                </p>
              </Card>

              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Package className="size-4" />
                  <p className="text-xs font-medium">Procurement</p>
                </div>
                <p className="mt-2 text-3xl font-bold">{dash.procurement.completed_prs}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  of {dash.procurement.total_prs} POs completed
                </p>
              </Card>
            </div>

            {/* Finance summary */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <IndianRupee className="size-4" />
                  <p className="text-xs font-medium">Total Committed</p>
                </div>
                <p className="mt-2 text-2xl font-bold">
                  ₹{formatINR(dash.finance.total_committed)}
                </p>
              </Card>
              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <IndianRupee className="size-4 text-success" />
                  <p className="text-xs font-medium">Total Paid</p>
                </div>
                <p className="mt-2 text-2xl font-bold text-success">
                  ₹{formatINR(dash.finance.total_paid)}
                </p>
              </Card>
              <Card className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <IndianRupee className="size-4 text-warning" />
                  <p className="text-xs font-medium">Outstanding</p>
                </div>
                <p className="mt-2 text-2xl font-bold text-warning">
                  ₹{formatINR(dash.finance.outstanding)}
                </p>
              </Card>
            </div>

            {/* Detailed tabs */}
            <Tabs defaultValue="progress">
              <TabsList className="flex h-auto flex-wrap gap-1">
                <TabsTrigger value="progress" className="gap-1.5">
                  <TrendingUp className="size-3.5" /> Block Progress
                </TabsTrigger>
                <TabsTrigger value="budget" className="gap-1.5">
                  <Wallet className="size-3.5" /> Budget vs Actual
                </TabsTrigger>
                <TabsTrigger value="quality" className="gap-1.5">
                  <BadgeCheck className="size-3.5" /> Quality
                </TabsTrigger>
                <TabsTrigger value="gatepass" className="gap-1.5">
                  <ScanLine className="size-3.5" /> Gate Pass
                </TabsTrigger>
                <TabsTrigger value="traceability" className="gap-1.5">
                  <Boxes className="size-3.5" /> Traceability
                </TabsTrigger>
              </TabsList>

              <TabsContent value="progress">
                <ClientProgressTab />
              </TabsContent>
              <TabsContent value="budget">
                <ClientBudgetTab />
              </TabsContent>
              <TabsContent value="quality">
                <ClientQualityTab />
              </TabsContent>
              <TabsContent value="gatepass">
                <ClientGatePassTab />
              </TabsContent>
              <TabsContent value="traceability">
                <Card className="p-6">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Boxes className="size-5" />
                    <p className="font-semibold">Material Traceability</p>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-xs text-muted-foreground">Total Material Batches</p>
                      <p className="mt-1 text-2xl font-bold">{dash.traceability.total_batches}</p>
                    </div>
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-xs text-muted-foreground">Verified Batches</p>
                      <p className="mt-1 text-2xl font-bold text-success">
                        {dash.traceability.verified_batches}
                      </p>
                    </div>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Failed to load dashboard data.
          </Card>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Progress Tab
// ============================================================================
function ClientProgressTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["client-progress"],
    queryFn: () => fetchClientProgress(),
  });
  const blocks = (data?.data ?? []) as any[];

  if (isLoading)
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </Card>
    );

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Block-wise Progress</p>
      </div>
      <div className="divide-y divide-border">
        {blocks.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No progress data available.
          </div>
        )}
        {blocks.map((b: any, i: number) => (
          <div key={i} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{b.name}</p>
              <p className="text-xs text-muted-foreground">
                {b.completed}/{b.total} cells completed
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${b.avgPct}%` }}
                />
              </div>
              <p className="w-12 text-right font-bold">{b.avgPct}%</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================================
// Budget Tab
// ============================================================================
function ClientBudgetTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["client-budget"],
    queryFn: () => fetchClientBudget(),
  });
  const budgets = (data?.data ?? []) as any[];

  if (isLoading)
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </Card>
    );

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Budget vs Actual by Block</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Block</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 text-right font-medium">Budget</th>
              <th className="px-4 py-3 text-right font-medium">Actual</th>
              <th className="px-4 py-3 text-right font-medium">Variance</th>
              <th className="px-4 py-3 text-right font-medium">Utilization</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {budgets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No budget data available.
                </td>
              </tr>
            )}
            {budgets.map((b: any) => {
              const variance = Number(b.budget_amount ?? 0) - Number(b.actual_amount ?? 0);
              const util =
                b.budget_amount > 0 ? Math.round((b.actual_amount / b.budget_amount) * 100) : 0;
              return (
                <tr key={b.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 font-medium">{b.block}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{b.category}</td>
                  <td className="px-4 py-3 text-right">₹{formatINR(b.budget_amount)}</td>
                  <td className="px-4 py-3 text-right">₹{formatINR(b.actual_amount)}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${variance < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {variance < 0 ? "-" : ""}₹{formatINR(Math.abs(variance))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-bold ${util > 100 ? "text-destructive" : util > 90 ? "text-warning" : "text-success"}`}
                    >
                      {util}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ============================================================================
// Quality Tab
// ============================================================================
function ClientQualityTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["client-quality"],
    queryFn: () => fetchClientQuality(),
  });
  const inspections = (data?.data ?? []) as any[];

  if (isLoading)
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </Card>
    );

  const passCount = inspections.filter((i) => i.result === "Pass").length;
  const failCount = inspections.filter((i) => i.result === "Fail").length;
  const reinspectCount = inspections.filter((i) => i.result === "Re-inspection").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Passed</p>
          <p className="mt-2 text-2xl font-bold text-success">{passCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Failed</p>
          <p className="mt-2 text-2xl font-bold text-destructive">{failCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Re-inspection</p>
          <p className="mt-2 text-2xl font-bold text-warning">{reinspectCount}</p>
        </Card>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <p className="font-semibold">Recent Inspections</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Material</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {inspections.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    No inspection data available.
                  </td>
                </tr>
              )}
              {inspections.slice(0, 50).map((insp: any) => (
                <tr key={insp.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3">{insp.material ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {insp.inspection_date
                      ? new Date(insp.inspection_date).toLocaleDateString("en-IN")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        insp.result === "Pass"
                          ? "bg-emerald-100 text-emerald-700"
                          : insp.result === "Fail"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {insp.result}
                    </span>
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
// Gate Pass Tab
// ============================================================================
function ClientGatePassTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["client-gatepass"],
    queryFn: () => fetchClientGatePass(),
  });
  const gatePasses = (data?.data ?? []) as any[];

  if (isLoading)
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </Card>
    );

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Recent Gate Passes</p>
        <p className="text-xs text-muted-foreground">Material movement through site gates</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">GP Number</th>
              <th className="px-4 py-3 font-medium">Material</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {gatePasses.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No gate pass data available.
                </td>
              </tr>
            )}
            {gatePasses.map((gp: any) => (
              <tr key={gp.id} className="hover:bg-surface/50">
                <td className="px-4 py-3 font-mono text-xs">{gp.gp_number}</td>
                <td className="px-4 py-3">{gp.material}</td>
                <td className="px-4 py-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {gp.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {new Date(gp.created_at).toLocaleDateString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
