// Cash flow forecast — outstanding payables, recent outflows, upcoming commitments and aging analysis.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fetchCashFlow } from "@/lib/api/cash-flow";
import { requireAuth } from "@/lib/auth-guards";
import { IndianRupee, ArrowDownCircle, Clock, AlertCircle, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/cash-flow")({
  head: () => ({
    meta: [
      { title: "Cash Flow Forecast — Meditrust ERP" },
      {
        name: "description",
        content:
          "Outstanding payables, recent outflows, upcoming commitments and vendor aging analysis.",
      },
    ],
  }),
  beforeLoad: () => {
    requireAuth();
  },
  component: CashFlowPage,
});

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

const AGING_LABELS: Record<string, string> = {
  current: "Current",
  "1-30": "1-30 days",
  "31-60": "31-60 days",
  "61-90": "61-90 days",
  "90+": "90+ days",
};

const AGING_COLORS: Record<string, string> = {
  current: "bg-success",
  "1-30": "bg-info",
  "31-60": "bg-warning",
  "61-90": "bg-orange-500",
  "90+": "bg-destructive",
};

// Main cash flow page with summary cards, aging chart, vendor payables and recent payments.
function CashFlowPage() {
  const { data } = useQuery({
    queryKey: ["cash-flow"],
    queryFn: () => fetchCashFlow(),
  });
  const summary = (data as any)?.summary;
  const vendorAging = (data as any)?.vendor_aging ?? [];
  const recentPayments = (data as any)?.recent_payments ?? [];
  const upcomingCommitments = (data as any)?.upcoming_commitments ?? [];

  const agingBuckets = summary?.aging_buckets ?? {};
  const totalOutstanding = summary?.total_outstanding ?? 0;

  return (
    <AppShell
      title="Cash flow forecast"
      subtitle="Outstanding payables, recent outflows & aging analysis"
    >
      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <IndianRupee className="size-4" />
            <p className="text-xs font-medium">Total outstanding</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-destructive">₹{formatINR(totalOutstanding)}</p>
          <p className="text-xs text-muted-foreground">{summary?.vendor_count ?? 0} vendors</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ArrowDownCircle className="size-4" />
            <p className="text-xs font-medium">Paid (30 days)</p>
          </div>
          <p className="mt-2 text-2xl font-bold">₹{formatINR(summary?.total_paid_30_days ?? 0)}</p>
          <p className="text-xs text-muted-foreground">{recentPayments.length} payments</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4" />
            <p className="text-xs font-medium">Upcoming commitments</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-warning">
            ₹{formatINR(summary?.total_upcoming ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            {upcomingCommitments.length} invoices pending
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingDown className="size-4" />
            <p className="text-xs font-medium">Net cash need</p>
          </div>
          <p className="mt-2 text-2xl font-bold">
            ₹{formatINR((summary?.total_outstanding ?? 0) + (summary?.total_upcoming ?? 0))}
          </p>
          <p className="text-xs text-muted-foreground">outstanding + upcoming</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Aging analysis */}
        <Card className="p-5">
          <p className="mb-4 font-semibold">Aging analysis</p>
          <div className="space-y-3">
            {Object.entries(agingBuckets).map(([bucket, amount]) => {
              const pct =
                totalOutstanding > 0
                  ? Math.round(((amount as number) / totalOutstanding) * 100)
                  : 0;
              return (
                <div key={bucket}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{AGING_LABELS[bucket] ?? bucket}</span>
                    <span className="font-medium">
                      ₹{formatINR(amount as number)}{" "}
                      <span className="text-xs text-muted-foreground">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface">
                    <div
                      className={`h-full rounded-full ${AGING_COLORS[bucket] ?? "bg-info"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Upcoming commitments */}
        <Card className="p-5">
          <p className="mb-4 font-semibold">Upcoming commitments</p>
          {upcomingCommitments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No invoices pending payment
            </p>
          ) : (
            <div className="space-y-2">
              {upcomingCommitments.slice(0, 8).map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                >
                  <div>
                    <p className="font-medium">{r.pr_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.invoice_number ?? "No invoice"} ·{" "}
                      {r.invoice_date ? new Date(r.invoice_date).toLocaleDateString("en-IN") : "—"}
                    </p>
                  </div>
                  <span className="font-medium">₹{formatINR(r.invoice_amount ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Vendor payables table */}
      <Card className="mt-6 overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <p className="font-semibold">Vendor payables</p>
          <p className="text-xs text-muted-foreground">Vendors with outstanding balances</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-right font-medium">Paid</th>
                <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Payment progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendorAging.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No outstanding vendor balances
                  </td>
                </tr>
              )}
              {vendorAging.map((v: any) => {
                const pct =
                  v.total_amount > 0 ? Math.round((v.amount_paid / v.total_amount) * 100) : 0;
                return (
                  <tr key={v.vendor_id} className="hover:bg-surface/50">
                    <td className="px-4 py-3 font-medium">{v.vendor_name}</td>
                    <td className="px-4 py-3 text-right">₹{formatINR(v.total_amount)}</td>
                    <td className="px-4 py-3 text-right text-success">
                      ₹{formatINR(v.amount_paid)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-destructive">
                      ₹{formatINR(v.outstanding_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 w-24" />
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent payments */}
      <Card className="mt-6 p-5">
        <p className="mb-4 font-semibold">Recent payments (last 30 days)</p>
        {recentPayments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No payments in the last 30 days
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recentPayments.slice(0, 12).map((p: any) => (
              <div key={p.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">₹{formatINR(p.amount)}</span>
                  <span className="text-xs text-muted-foreground">{p.payment_type}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.payment_date ? new Date(p.payment_date).toLocaleDateString("en-IN") : "—"}
                  {p.reference_number ? ` · ${p.reference_number}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
