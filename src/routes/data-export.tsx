// Data Backup & Export — overview of all tables with row counts, CSV/Excel export
// per table, and optional date-range filtering for tables with date columns.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
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
import { fetchBackupOverview, exportTableData } from "@/lib/api/system-robustness";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Database, Download, Loader2, Search, Lock, FileDown, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/data-export")({
  head: () => ({
    meta: [
      { title: "Data Backup & Export — Meditrust ERP" },
      {
        name: "description",
        content: "Export all ERP data tables as CSV files for backup and analysis.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: DataExportPage,
});

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
          const str =
            typeof val === "object" ? JSON.stringify(val) : String(val).replace(/"/g, '""');
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
  toast.success(`Exported ${rows.length} rows from ${filename}`);
}

// Converts an array of objects to an Excel-compatible HTML table (.xls) and triggers a download.
// This approach requires no external library — Excel opens HTML tables natively.
function exportExcel(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) {
    toast.error("No data to export");
    return;
  }
  const firstRow = rows[0] ?? {};
  const headers = Object.keys(firstRow);

  const escapeHtml = (val: unknown): string => {
    if (val == null) return "";
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  const tableRows = rows
    .map(
      (row) =>
        `<tr>${headers.map((h) => `<td style="mso-number-format:'\\@'">${escapeHtml(row[h])}</td>`).join("")}</tr>`,
    )
    .join("");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${filename}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body><table border="1"><thead><tr>${headers.map((h) => `<th style="background:#f0f0f0;font-weight:bold">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} rows from ${filename} (Excel)`);
}

// Tables that support date-range filtering (must have a date column in the DB).
const DATE_FILTERABLE_TABLES: Record<string, boolean> = {
  requisitions: true,
  gate_passes: true,
  batches: true,
  inspections: true,
  visitors: true,
  vehicles: true,
  labour: true,
  inventory_transactions: true,
  vendor_payments: true,
  tds_gst_records: true,
  retention_records: true,
  approval_delegations: true,
  escalation_log: true,
  document_versions: true,
};

// Main data export page with table overview, per-table CSV/Excel download,
// and date-range filtering for tables with date columns.
function DataExportPage() {
  const { role } = useRole();
  const { data, isLoading } = useQuery({
    queryKey: ["backup-overview"],
    queryFn: () => fetchBackupOverview({ data: {} }),
  });
  const tables = (data?.data ?? []) as any[];

  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "excel">("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const canAccess = role === "A1+" || role === "Administrator";

  const handleExport = async (table: string) => {
    setExporting(table);
    try {
      const payload: {
        table: string;
        dateFrom?: string;
        dateTo?: string;
        format?: "csv" | "excel";
      } = {
        table,
        format: exportFormat,
      };
      if (dateFrom) payload.dateFrom = dateFrom;
      if (dateTo) payload.dateTo = dateTo;
      const result = await exportTableData({ data: payload });
      if (result.error) {
        toast.error(result.error);
      } else {
        const rows = result.data as Record<string, any>[];
        if (exportFormat === "excel") {
          exportExcel(table, rows);
        } else {
          exportCSV(table, rows);
        }
      }
    } catch {
      toast.error("Failed to export table");
    }
    setExporting(null);
  };

  const handleExportAll = async () => {
    for (const t of tables) {
      if (t.count > 0) {
        await handleExport(t.table);
      }
    }
  };

  const hasDateFilter = !!(dateFrom || dateTo);

  const filtered = tables.filter((t) => t.table.toLowerCase().includes(search.toLowerCase()));
  const totalRows = tables.reduce((s, t) => s + t.count, 0);
  const nonEmptyTables = tables.filter((t) => t.count > 0).length;

  if (!canAccess) {
    return (
      <AppShell title="Data backup & export" subtitle="Export all ERP data tables as CSV">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Lock className="mx-auto mb-2 size-8 text-muted-foreground" />
          You need Administrator or A1+ privileges to access data export.
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Data backup & export" subtitle="Export all ERP data tables as CSV files">
      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="size-4" />
            <p className="text-xs font-medium">Total tables</p>
          </div>
          <p className="mt-2 text-2xl font-bold">{tables.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileDown className="size-4" />
            <p className="text-xs font-medium">Tables with data</p>
          </div>
          <p className="mt-2 text-2xl font-bold">{nonEmptyTables}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="size-4" />
            <p className="text-xs font-medium">Total rows</p>
          </div>
          <p className="mt-2 text-2xl font-bold">{totalRows.toLocaleString("en-IN")}</p>
        </Card>
      </div>

      {/* Actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tables..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48 pl-9"
            />
          </div>
          {/* Format selector */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Format</Label>
            <Select
              value={exportFormat}
              onValueChange={(val) => setExportFormat(val as "csv" | "excel")}
            >
              <SelectTrigger className="w-28 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="excel">Excel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Date range filter */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36 h-9"
            />
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36 h-9"
            />
            {(dateFrom || dateTo) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={handleExportAll} disabled={exporting !== null}>
          {exporting !== null ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : exportFormat === "excel" ? (
            <FileSpreadsheet className="mr-1.5 size-4" />
          ) : (
            <Download className="mr-1.5 size-4" />
          )}
          Export all ({nonEmptyTables})
        </Button>
      </div>

      {/* Date filter notice */}
      {hasDateFilter && (
        <div className="mb-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
          Date filter active: {dateFrom || "start"} to {dateTo || "end"}. Only tables with date
          columns will be filtered; others export all rows.
        </div>
      )}

      {/* Table list */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Table</th>
                <th className="px-4 py-3 text-right font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {isLoading ? "Loading..." : "No tables found."}
                  </td>
                </tr>
              )}
              {filtered.map((t: any) => (
                <tr key={t.table} className="hover:bg-surface/50">
                  <td className="px-4 py-3 font-mono text-xs font-medium">
                    {t.table}
                    {DATE_FILTERABLE_TABLES[t.table] && (
                      <span className="ml-2 text-[10px] text-muted-foreground">(date filter)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {t.count.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    {t.count > 0 ? (
                      <span className="text-xs font-medium text-success">Has data</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Empty</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleExport(t.table)}
                      disabled={exporting === t.table || t.count === 0}
                    >
                      {exporting === t.table ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : exportFormat === "excel" ? (
                        <FileSpreadsheet className="size-3.5" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
