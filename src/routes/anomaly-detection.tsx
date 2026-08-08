// AI Anomaly Detection — flags suspicious patterns in procurement, invoices, gate passes, and budgets.
// Users can run detection on-demand, review flagged anomalies, and dismiss false positives.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { runAnomalyDetection, fetchAnomalies, dismissAnomaly } from "@/lib/api/anomaly-detection";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Brain,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Copy,
  ScanLine,
  Wallet,
  CheckCircle,
  XCircle,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/anomaly-detection")({
  head: () => ({
    meta: [
      { title: "AI Anomaly Detection — Meditrust ERP" },
      {
        name: "description",
        content:
          "AI-powered detection of high quotations, duplicate invoices, gate pass anomalies, and budget overruns.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: AnomalyDetectionPage,
});

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info"> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

const TYPE_ICON: Record<string, typeof TrendingUp> = {
  high_quotation: TrendingUp,
  duplicate_invoice: Copy,
  gate_pass_anomaly: ScanLine,
  budget_overrun: Wallet,
};

const TYPE_LABEL: Record<string, string> = {
  high_quotation: "High Quotation",
  duplicate_invoice: "Duplicate Invoice",
  gate_pass_anomaly: "Gate Pass Anomaly",
  budget_overrun: "Budget Overrun",
};

function AnomalyDetectionPage() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [dismissing, setDismissing] = useState<string | null>(null);

  const { data: anomalyData, isLoading } = useQuery({
    queryKey: ["anomalies", filter],
    queryFn: () =>
      fetchAnomalies({ data: { dismissed: false, ...(filter !== "all" ? { type: filter } : {}) } }),
  });
  const anomalies = (anomalyData?.data ?? []) as any[];

  const { data: dismissedData } = useQuery({
    queryKey: ["anomalies-dismissed"],
    queryFn: () => fetchAnomalies({ data: { dismissed: true } }),
  });
  const dismissed = (dismissedData?.data ?? []) as any[];

  const handleRun = async () => {
    setRunning(true);
    try {
      const result = await runAnomalyDetection({ data: {} });
      if (result.success) {
        toast.success(
          `Detection complete: ${result.total} anomalies found (${result.by_severity.high} high, ${result.by_severity.medium} medium, ${result.by_severity.low} low)`,
        );
        queryClient.invalidateQueries({ queryKey: ["anomalies"] });
        queryClient.invalidateQueries({ queryKey: ["anomalies-dismissed"] });
      } else {
        toast.error("Detection failed");
      }
    } catch {
      toast.error("Detection failed");
    }
    setRunning(false);
  };

  const handleDismiss = async (id: string) => {
    setDismissing(id);
    try {
      const result = await dismissAnomaly({ data: { id } });
      if (result.success) {
        toast.success("Anomaly dismissed");
        queryClient.invalidateQueries({ queryKey: ["anomalies"] });
        queryClient.invalidateQueries({ queryKey: ["anomalies-dismissed"] });
      } else {
        toast.error(result.error ?? "Failed to dismiss");
      }
    } catch {
      toast.error("Failed to dismiss");
    }
    setDismissing(null);
  };

  const highCount = anomalies.filter((a) => a.severity === "high").length;
  const mediumCount = anomalies.filter((a) => a.severity === "medium").length;
  const lowCount = anomalies.filter((a) => a.severity === "low").length;

  return (
    <AppShell
      title="AI Anomaly Detection"
      subtitle="Automated detection of suspicious patterns across procurement, invoices, gate passes, and budgets"
    >
      <Tabs defaultValue="active" className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="active" className="gap-1.5">
              <AlertTriangle className="size-3.5" /> Active ({anomalies.length})
            </TabsTrigger>
            <TabsTrigger value="dismissed" className="gap-1.5">
              <CheckCircle className="size-3.5" /> Dismissed ({dismissed.length})
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="high_quotation">High Quotations</SelectItem>
                <SelectItem value="duplicate_invoice">Duplicate Invoices</SelectItem>
                <SelectItem value="gate_pass_anomaly">Gate Pass</SelectItem>
                <SelectItem value="budget_overrun">Budget Overrun</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleRun} disabled={running}>
              {running ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 size-4" />
              )}
              Run Detection
            </Button>
          </div>
        </div>

        <TabsContent value="active">
          {/* Summary cards */}
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Brain className="size-4" />
                <p className="text-xs font-medium">Total Active</p>
              </div>
              <p className="mt-2 text-2xl font-bold">{anomalies.length}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4 text-destructive" />
                <p className="text-xs font-medium">High Severity</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-destructive">{highCount}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4 text-warning" />
                <p className="text-xs font-medium">Medium</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-warning">{mediumCount}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4 text-info" />
                <p className="text-xs font-medium">Low</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-info">{lowCount}</p>
            </Card>
          </div>

          {/* Anomaly list */}
          <AnomalyList
            anomalies={anomalies}
            isLoading={isLoading}
            dismissing={dismissing}
            onDismiss={handleDismiss}
          />
        </TabsContent>

        <TabsContent value="dismissed">
          <AnomalyList
            anomalies={dismissed}
            isLoading={false}
            dismissing={null}
            onDismiss={() => {}}
            dismissed
          />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function AnomalyList({
  anomalies,
  isLoading,
  dismissing,
  onDismiss,
  dismissed = false,
}: {
  anomalies: any[];
  isLoading: boolean;
  dismissing: string | null;
  onDismiss: (id: string) => void;
  dismissed?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (anomalies.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        {dismissed
          ? "No dismissed anomalies."
          : 'No anomalies detected. Click "Run Detection" to scan for suspicious patterns.'}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.map((a: any) => {
        const Icon = TYPE_ICON[a.anomaly_type] ?? AlertTriangle;
        return (
          <Card key={a.id} className="p-4">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  a.severity === "high"
                    ? "bg-destructive/10 text-destructive"
                    : a.severity === "medium"
                      ? "bg-warning/10 text-warning"
                      : "bg-info/10 text-info"
                }`}
              >
                <Icon className="size-4.5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{a.title}</p>
                  <StatusPill tone={SEVERITY_TONE[a.severity] ?? "info"}>{a.severity}</StatusPill>
                  <span className="text-xs text-muted-foreground">
                    {TYPE_LABEL[a.anomaly_type] ?? a.anomaly_type}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{a.description}</p>
                <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
                  <span>
                    Detected:{" "}
                    {new Date(a.detected_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  {dismissed && a.dismissed_at && (
                    <span>
                      Dismissed:{" "}
                      {new Date(a.dismissed_at).toLocaleString("en-IN", { dateStyle: "short" })}
                    </span>
                  )}
                  {!dismissed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDismiss(a.id)}
                      disabled={dismissing === a.id}
                      className="ml-auto h-7 text-xs"
                    >
                      {dismissing === a.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <>
                          <XCircle className="mr-1 size-3" /> Dismiss
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
