// Daily Site Diary — auto-generated daily summary from existing data with print support.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { fetchDailyDiary } from "@/lib/api/daily-diary";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Calendar,
  Printer,
  HardHat,
  Users,
  Car,
  ScanLine,
  BadgeCheck,
  Boxes,
  ClipboardList,
  TrendingUp,
  Package,
  IndianRupee,
} from "lucide-react";

export const Route = createFileRoute("/daily-diary")({
  head: () => ({
    meta: [
      { title: "Daily Site Diary — Meditrust ERP" },
      {
        name: "description",
        content:
          "Auto-generated daily site diary from labour, visitors, vehicles, gate passes, QC, and procurement data.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: DailyDiaryPage,
});

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Main daily diary page with date picker, summary cards, and detailed sections.
function DailyDiaryPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ["daily-diary", date],
    queryFn: () => fetchDailyDiary({ data: { date } }),
  });
  const r = data as any;

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    if (!r) {
      toast.error("No data to export");
      return;
    }
    const lines = [
      `Daily Site Diary — ${r.date}`,
      `Meditrust Hospital Construction Project`,
      "",
      `SUMMARY`,
      `Total labour planned: ${r.summary.total_labour_planned}`,
      `Total labour present: ${r.summary.total_labour_present}`,
      `Labour productivity: ${r.summary.labour_productivity_pct}%`,
      `Visitors: ${r.summary.visitors_count}`,
      `Vehicles: ${r.summary.vehicles_count}`,
      `Gate passes: ${r.summary.gate_passes_count}`,
      `Inspections: ${r.summary.inspections_count} (Pass: ${r.summary.inspections_pass}, Fail: ${r.summary.inspections_fail})`,
      `Batches registered: ${r.summary.batches_count}`,
      `Requisitions: ${r.summary.requisitions_count} (₹${formatINR(r.summary.requisitions_amount)})`,
      `Progress updates: ${r.summary.progress_updates}`,
      `Inventory transactions: ${r.summary.inventory_transactions}`,
      "",
      `LABOUR ATTENDANCE`,
      ...(r.labour.length === 0
        ? ["No labour entries"]
        : r.labour.map(
            (l: any) =>
              `  ${l.trade} — ${l.present}/${l.planned} (${l.block ?? "—"}) [${l.contractor ?? "—"}]`,
          )),
      "",
      `VISITORS`,
      ...(r.visitors.length === 0
        ? ["No visitors"]
        : r.visitors.map(
            (v: any) =>
              `  ${v.name} (${v.org ?? "—"}) — ${v.purpose ?? "—"} [Host: ${v.host ?? "—"}]`,
          )),
      "",
      `VEHICLES`,
      ...(r.vehicles.length === 0
        ? ["No vehicles"]
        : r.vehicles.map(
            (v: any) =>
              `  ${v.number} — ${v.type ?? "—"} [Driver: ${v.driver ?? "—"}] Material: ${v.material ?? "—"}`,
          )),
      "",
      `GATE PASSES`,
      ...(r.gate_passes.length === 0
        ? ["No gate passes"]
        : r.gate_passes.map(
            (g: any) =>
              `  ${g.gp_number} — ${g.material} (${g.qty}) [${g.status}] ${g.from_location ?? ""} → ${g.to_location ?? ""}`,
          )),
      "",
      `INSPECTIONS`,
      ...(r.inspections.length === 0
        ? ["No inspections"]
        : r.inspections.map(
            (i: any) =>
              `  ${i.qc_number} — ${i.activity} [${i.result}] Inspector: ${i.inspector ?? "—"}`,
          )),
      "",
      `BATCHES`,
      ...(r.batches.length === 0
        ? ["No batches"]
        : r.batches.map(
            (b: any) =>
              `  ${b.batch_number} — ${b.material} [${b.status}] Supplier: ${b.supplier ?? "—"}`,
          )),
      "",
      `REQUISITIONS`,
      ...(r.requisitions.length === 0
        ? ["No requisitions"]
        : r.requisitions.map(
            (q: any) => `  ${q.pr_number} — ${q.title} [${q.stage}] ₹${formatINR(q.amount)}`,
          )),
      "",
      `PROGRESS UPDATES`,
      ...(r.progress.length === 0
        ? ["No progress updates"]
        : r.progress.map((p: any) => `  ${p.block} — ${p.pct}%`)),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `site-diary-${r.date}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Diary exported");
  };

  return (
    <AppShell
      title="Daily site diary"
      subtitle="Auto-generated daily summary from all site activities"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Printer className="mr-1.5 size-4" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrint}>
            <Printer className="mr-1.5 size-4" /> Print
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading diary...</Card>
      ) : !r ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No data available.</Card>
      ) : (
        <div className="space-y-6">
          {/* Print header — only visible when printing */}
          <div className="hidden print:block">
            <h1 className="text-2xl font-bold">Daily Site Diary</h1>
            <p className="text-sm">Meditrust Hospital Construction Project</p>
            <p className="text-sm">
              Date:{" "}
              {new Date(r.date).toLocaleDateString("en-IN", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <DiaryCard
              icon={<HardHat className="size-4" />}
              label="Labour"
              value={`${r.summary.total_labour_present}/${r.summary.total_labour_planned}`}
              sub={`${r.summary.labour_productivity_pct}% productivity`}
            />
            <DiaryCard
              icon={<Users className="size-4" />}
              label="Visitors"
              value={r.summary.visitors_count}
            />
            <DiaryCard
              icon={<Car className="size-4" />}
              label="Vehicles"
              value={r.summary.vehicles_count}
            />
            <DiaryCard
              icon={<ScanLine className="size-4" />}
              label="Gate passes"
              value={r.summary.gate_passes_count}
            />
            <DiaryCard
              icon={<BadgeCheck className="size-4" />}
              label="Inspections"
              value={r.summary.inspections_count}
              sub={`${r.summary.inspections_pass} pass / ${r.summary.inspections_fail} fail`}
            />
            <DiaryCard
              icon={<ClipboardList className="size-4" />}
              label="Requisitions"
              value={r.summary.requisitions_count}
              sub={`₹${formatINR(r.summary.requisitions_amount)}`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Labour attendance */}
            <DiarySection
              title="Labour attendance"
              icon={<HardHat className="size-4" />}
              count={r.labour.length}
            >
              {r.labour.length === 0 ? (
                <EmptyState />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">Trade</th>
                      <th className="pb-2 text-right font-medium">Present</th>
                      <th className="pb-2 text-right font-medium">Planned</th>
                      <th className="pb-2 font-medium">Block</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {r.labour.map((l: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 font-medium">{l.trade}</td>
                        <td className="py-2 text-right text-success">{l.present}</td>
                        <td className="py-2 text-right text-muted-foreground">{l.planned}</td>
                        <td className="py-2 text-xs">{l.block ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </DiarySection>

            {/* Visitors */}
            <DiarySection
              title="Visitors"
              icon={<Users className="size-4" />}
              count={r.visitors.length}
            >
              {r.visitors.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.visitors.map((v: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-medium">{v.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.org ?? "—"} · {v.purpose ?? "—"}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>
                          In:{" "}
                          {v.in_time
                            ? new Date(v.in_time).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </p>
                        <p>
                          Out:{" "}
                          {v.out_time
                            ? new Date(v.out_time).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Vehicles */}
            <DiarySection
              title="Vehicles"
              icon={<Car className="size-4" />}
              count={r.vehicles.length}
            >
              {r.vehicles.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.vehicles.map((v: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-mono font-medium">{v.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.type ?? "—"} · {v.driver ?? "—"}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">{v.material ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Gate passes */}
            <DiarySection
              title="Gate passes"
              icon={<ScanLine className="size-4" />}
              count={r.gate_passes.length}
            >
              {r.gate_passes.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.gate_passes.map((g: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-mono font-medium">{g.gp_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.material} · {g.qty}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-medium ${g.status === "Exited" ? "text-success" : "text-warning"}`}
                      >
                        {g.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Inspections */}
            <DiarySection
              title="Quality inspections"
              icon={<BadgeCheck className="size-4" />}
              count={r.inspections.length}
            >
              {r.inspections.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.inspections.map((i: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-medium">{i.qc_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {i.activity} · {i.location ?? "—"}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-medium ${i.result === "Pass" ? "text-success" : i.result === "Fail" ? "text-destructive" : "text-warning"}`}
                      >
                        {i.result}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Requisitions */}
            <DiarySection
              title="Requisitions raised"
              icon={<ClipboardList className="size-4" />}
              count={r.requisitions.length}
            >
              {r.requisitions.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.requisitions.map((q: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-mono font-medium">{q.pr_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {q.title} · {q.block ?? "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">₹{formatINR(q.amount)}</p>
                        <p className="text-xs text-muted-foreground">{q.stage}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Batches */}
            <DiarySection
              title="Material batches"
              icon={<Boxes className="size-4" />}
              count={r.batches.length}
            >
              {r.batches.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.batches.map((b: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-mono font-medium">{b.batch_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.material} · {b.supplier ?? "—"}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">{b.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Progress updates */}
            <DiarySection
              title="Progress updates"
              icon={<TrendingUp className="size-4" />}
              count={r.progress.length}
            >
              {r.progress.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-3">
                  {r.progress.map((p: any, i: number) => (
                    <div key={i}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{p.block}</span>
                        <span className="text-xs text-muted-foreground">{p.pct}%</span>
                      </div>
                      <Progress value={p.pct} className="h-1.5" />
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>

            {/* Inventory transactions */}
            <DiarySection
              title="Inventory movements"
              icon={<Package className="size-4" />}
              count={r.inventory_transactions.length}
            >
              {r.inventory_transactions.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-2">
                  {r.inventory_transactions.map((t: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-medium">{t.item_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{t.notes ?? ""}</p>
                      </div>
                      <span
                        className={`text-xs font-medium ${t.type === "IN" || t.type === "Receipt" ? "text-success" : "text-warning"}`}
                      >
                        {t.type} · {t.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </DiarySection>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function DiaryCard({
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
      <p className="mt-2 text-xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function DiarySection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <p className="font-semibold">{title}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {count} {count !== 1 ? "entries" : "entry"}
        </span>
      </div>
      {children}
    </Card>
  );
}

function EmptyState() {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">No entries for this date.</p>
  );
}
