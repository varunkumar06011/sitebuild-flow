// Vendor scorecard — admin-only, one card per vendor with computed 0-100 score
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchVendors } from "@/lib/api/vendors";
import { getVendorScorecard } from "@/lib/api/vendor-scorecard";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  Award,
  TrendingUp,
  ShieldCheck,
  Truck,
  Wallet,
  Wrench,
} from "lucide-react";

export const Route = createFileRoute("/vendor-scorecard")({
  head: () => ({
    meta: [
      { title: "Vendor Scorecards — Meditrust ERP" },
      {
        name: "description",
        content:
          "Computed vendor performance scores from quality, logistics, safety, and punch item data.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: VendorScorecardPage,
});

const GRADE_TONE: Record<string, "success" | "info" | "warning" | "danger"> = {
  A: "success",
  B: "info",
  C: "warning",
  D: "warning",
  F: "danger",
};

const SCORE_ICONS: Record<string, typeof Award> = {
  quality: Award,
  logistics: Truck,
  financial: Wallet,
  safety: ShieldCheck,
  punch: Wrench,
};

function VendorScorecardPage() {
  const { role } = useRole();
  const isAdmin = role === "Administrator" || role === "A1" || role === "A1+";

  const tourSteps: TourStep[] = [
    {
      selector: '[data-tour="vs-search-input"]',
      title: "Search Vendors",
      description: "Type a vendor name to find a specific contractor or supplier quickly.",
    },
    {
      selector: '[data-tour="vs-cat-filter"]',
      title: "Filter by Work Category",
      description:
        "Narrow vendors to Civil, Structural, or other categories to evaluate trades separately.",
    },
    {
      selector: '[data-tour="vs-card"]',
      title: "Vendor Score Card",
      description:
        "Each card shows a computed 0-100 score and grade (A-F) — click any card to see the full breakdown of quality, logistics, financial, safety, and punch item metrics.",
    },
    {
      selector: '[data-tour="vs-detail"]',
      title: "Detailed Scorecard Dialog",
      description:
        "View per-category scores with progress bars and the underlying metrics that contribute to the vendor's overall grade.",
    },
  ];

  const [search, setSearch] = useState("");
  const [workCatFilter, setWorkCatFilter] = useState("all");
  const [detailVendor, setDetailVendor] = useState<any | null>(null);

  const { data: vendorData, isLoading } = useQuery({
    queryKey: ["vendors", search, workCatFilter],
    queryFn: () =>
      fetchVendors({
        ...(search && { search }),
        ...(workCatFilter !== "all" && { workCategory: workCatFilter }),
        limit: 100,
      }),
  });
  const vendors = vendorData?.data ?? [];

  // Fetch scorecards for all vendors (one query per vendor, batched via enabled)
  const scorecardQueries = useQuery({
    queryKey: ["vendorScorecards", vendors.map((v: any) => v.id).join(",")],
    queryFn: async () => {
      const results: Record<string, any> = {};
      for (const v of vendors) {
        try {
          const sc = await getVendorScorecard({ vendorId: (v as any).id });
          if (sc.success !== false) {
            results[(v as any).id] = sc;
          }
        } catch {
          // skip vendors that fail
        }
      }
      return results;
    },
    enabled: vendors.length > 0 && isAdmin,
  });

  const scorecards = (scorecardQueries.data as Record<string, any>) ?? {};

  // Detail dialog scorecard
  const { data: detailScore, isFetching: detailLoading } = useQuery({
    queryKey: ["vendorScorecard", detailVendor?.id],
    queryFn: () => getVendorScorecard({ vendorId: detailVendor.id }),
    enabled: !!detailVendor,
  });

  if (!isAdmin) {
    return (
      <AppShell title="Vendor Scorecards" subtitle="Vendor performance scoring">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Only administrators can view vendor scorecards.
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Vendor Scorecards"
      subtitle="Computed performance scores from quality, logistics, safety, and punch data"
    >
      <div className="mb-4 flex items-center justify-end">
        <SectionTour sectionKey="vendor-scorecard" steps={tourSteps} />
      </div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vendors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 pl-9"
            data-tour="vs-search-input"
          />
        </div>
        <Select value={workCatFilter} onValueChange={setWorkCatFilter}>
          <SelectTrigger className="w-40" data-tour="vs-cat-filter">
            <SelectValue placeholder="Work category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="civil">Civil</SelectItem>
            <SelectItem value="structural">Structural</SelectItem>
            <SelectItem value="uncategorized">Uncategorized</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      )}

      {!isLoading && vendors.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">No vendors found.</Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v: any) => {
          const sc = scorecards[v.id];
          const score = sc?.total_score ?? null;
          const grade = sc?.grade ?? null;
          return (
            <Card
              key={v.id}
              data-tour={vendors.indexOf(v) === 0 ? "vs-card" : undefined}
              className="cursor-pointer p-5 transition-colors hover:bg-accent/50"
              onClick={() => setDetailVendor(v)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{v.name}</p>
                  <p className="text-xs text-muted-foreground">{v.work_category}</p>
                </div>
                {grade && <StatusPill tone={GRADE_TONE[grade] ?? "neutral"}>{grade}</StatusPill>}
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Score</p>
                  <p
                    className={`text-3xl font-bold ${
                      score === null
                        ? "text-muted-foreground"
                        : score >= 75
                          ? "text-success"
                          : score >= 50
                            ? "text-warning-foreground"
                            : "text-destructive"
                    }`}
                  >
                    {score === null ? "—" : score}
                  </p>
                </div>
                {sc?.breakdown && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(sc.breakdown).map(([key, val]: [string, any]) => {
                      const Icon = SCORE_ICONS[key] ?? TrendingUp;
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                          title={`${val.label}: ${val.score}/${val.max}`}
                        >
                          <Icon className="size-3" /> {val.score}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              {score === null && !scorecardQueries.isLoading && (
                <p className="mt-2 text-xs text-muted-foreground">Click to compute scorecard</p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailVendor} onOpenChange={(open) => !open && setDetailVendor(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-tour="vs-detail">
          <DialogHeader>
            <DialogTitle>{detailVendor?.name} — Scorecard</DialogTitle>
            <DialogDescription>
              Computed from quality, logistics, financial, safety, and punch item data
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
            </div>
          ) : detailScore && (detailScore as any).breakdown ? (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between rounded-lg bg-muted p-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Score</p>
                  <p className="text-4xl font-bold">
                    {(detailScore as any).total_score}
                    <span className="text-lg text-muted-foreground">/100</span>
                  </p>
                </div>
                <StatusPill tone={GRADE_TONE[(detailScore as any).grade] ?? "neutral"}>
                  Grade {(detailScore as any).grade}
                </StatusPill>
              </div>

              {Object.entries((detailScore as any).breakdown).map(([key, val]: [string, any]) => {
                const Icon = SCORE_ICONS[key] ?? TrendingUp;
                const pct = Math.round((val.score / val.max) * 100);
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-sm font-medium">
                        <Icon className="size-4 text-muted-foreground" />
                        {val.label}
                      </span>
                      <span className="text-sm font-semibold">
                        {val.score}/{val.max}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${
                          pct >= 75 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-destructive"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {val.detail && (
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {Object.entries(val.detail).map(([dk, dv]) => (
                          <span key={dk}>
                            {dk.replace(/_/g, " ")}: {String(dv)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Failed to load scorecard
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
