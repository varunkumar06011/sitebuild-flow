// Documents management page — centralized document storage with OCR, expiry tracking, and filtering.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentUrl,
  type DocumentRow,
  type DocumentType,
} from "@/lib/api/documents";
import { fetchVendors } from "@/lib/api/vendors";
import { fetchBlocks } from "@/lib/api/inventory";
import { uploadFile, getSignedUrl } from "@/lib/api/storage";
import { WorkCategorySelect, WorkCategoryBadge } from "@/components/WorkCategory";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { inr } from "@/lib/erp-data";
import { toast } from "sonner";
import {
  Plus,
  Search,
  FileText,
  Pencil,
  Eye,
  Trash2,
  Download,
  X,
  Loader2,
  AlertCircle,
  ScanText,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [{ title: "Documents — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: DocumentsPage,
});

const DOCUMENT_TYPES: DocumentType[] = [
  "Licence",
  "Permit",
  "Certificate",
  "Agreement",
  "Bill / Invoice",
  "Receipt",
  "Land Document",
  "Photo / Screenshot",
  "Report",
  "Contract",
  "Other",
];

const EXPIRY_STATUSES = ["Active", "Expiring Soon", "Expired", "No Expiry"];

function expiryTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "Active":
      return "success";
    case "Expiring Soon":
      return "warning";
    case "Expired":
      return "danger";
    default:
      return "neutral";
  }
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// OCR extraction logic — runs client-side via tesseract.js
// ---------------------------------------------------------------------------
function extractFromOcrText(text: string): {
  suggestedName: string | null;
  amount: number | null;
  expiryDate: string | null;
  licenceNumber: string | null;
} {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const result: {
    suggestedName: string | null;
    amount: number | null;
    expiryDate: string | null;
    licenceNumber: string | null;
  } = { suggestedName: null, amount: null, expiryDate: null, licenceNumber: null };

  // Suggest name from first meaningful line
  if (lines.length > 0) {
    const meaningful = lines.find((l) => l.length > 3 && l.length < 80);
    if (meaningful) result.suggestedName = meaningful;
  }

  // Extract amount — look for ₹ or patterns like "Total: 12,345" or "Amount: 5000"
  const amountRegex = /(?:₹|rs\.?|amount|total|amt)\s*[:.]?\s*([0-9][0-9,]*\.?[0-9]*)/i;
  const amountMatch = text.match(amountRegex);
  if (amountMatch?.[1]) {
    const num = parseFloat(amountMatch[1].replace(/,/g, ""));
    if (!isNaN(num) && num > 0) result.amount = num;
  }

  // Extract expiry date — look for "Valid Until", "Expiry", "Expires On", date patterns
  const expiryRegexes = [
    /(?:valid\s*(?:until|upto|to)|expir(?:y|es)\s*(?:on|date)?|expiry)\s*[:.]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:valid\s*(?:until|upto|to)|expir(?:y|es)\s*(?:on|date)?|expiry)\s*[:.]?\s*(\d{4}-\d{2}-\d{2})/i,
  ];
  for (const re of expiryRegexes) {
    const m = text.match(re);
    if (m?.[1]) {
      const parsed = new Date(m[1]);
      if (!isNaN(parsed.getTime())) {
        result.expiryDate = parsed.toISOString().split("T")[0] ?? null;
        break;
      }
    }
  }

  // Extract licence number — look for "Licence No", "License Number", "Reg No"
  const licRegex =
    /(?:licen[cs]e|lic\.?|reg(?:istration)?\.?)\s*(?:no\.?|number|#)\s*[:.]?\s*([A-Z0-9\-\/]{4,20})/i;
  const licMatch = text.match(licRegex);
  if (licMatch?.[1]) result.licenceNumber = licMatch[1];

  return result;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
function DocumentsPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const canEdit = role === "Administrator" || role === "A1" || role === "A1+";

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [blockFilter, setBlockFilter] = useState("all");
  const [workCatFilter, setWorkCatFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [form, setForm] = useState({
    name: "",
    document_type: "Other" as DocumentType,
    amount: "",
    expiry_date: "",
    licence_number: "",
    block_id: "",
    vendor_id: "",
    project_name: "",
    customer_name: "",
    related_entity: "",
    ocr_text: "",
    work_category: "uncategorized",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  // Queries
  const {
    data: docsData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [
      "documents",
      search,
      typeFilter,
      expiryFilter,
      vendorFilter,
      blockFilter,
      workCatFilter,
    ],
    queryFn: () =>
      fetchDocuments({
        data: {
          search: search || undefined,
          documentType: typeFilter !== "all" ? typeFilter : undefined,
          expiryStatus: expiryFilter !== "all" ? expiryFilter : undefined,
          vendorId: vendorFilter !== "all" ? vendorFilter : undefined,
          blockId: blockFilter !== "all" ? blockFilter : undefined,
          workCategory: workCatFilter !== "all" ? workCatFilter : undefined,
        } as any,
      }),
  });

  const { data: vendorsData } = useQuery({
    queryKey: ["vendors", "all"],
    queryFn: () => fetchVendors({ data: { limit: 200 } }),
  });

  const { data: blocksData } = useQuery({
    queryKey: ["blocks"],
    queryFn: () => fetchBlocks({ data: {} }),
  });

  const documents = docsData?.data ?? [];
  const vendors = vendorsData?.data ?? [];
  const blocks = blocksData?.data ?? [];

  function resetForm() {
    setForm({
      name: "",
      document_type: "Other",
      amount: "",
      expiry_date: "",
      licence_number: "",
      block_id: "",
      vendor_id: "",
      project_name: "",
      customer_name: "",
      related_entity: "",
      ocr_text: "",
      work_category: "uncategorized",
    });
    setSelectedFile(null);
    setUploadedPath(null);
    setOcrLoading(false);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(doc: DocumentRow) {
    setEditing(doc);
    setForm({
      name: doc.name,
      document_type: doc.document_type,
      amount: doc.amount !== null ? String(doc.amount) : "",
      expiry_date: doc.expiry_date ?? "",
      licence_number: doc.licence_number ?? "",
      block_id: doc.block_id ?? "",
      vendor_id: doc.vendor_id ?? "",
      project_name: doc.project_name ?? "",
      customer_name: doc.customer_name ?? "",
      related_entity: doc.related_entity ?? "",
      ocr_text: doc.ocr_text ?? "",
      work_category: doc.work_category ?? "uncategorized",
    });
    setSelectedFile(null);
    setUploadedPath(null);
    setDialogOpen(true);
  }

  // -------------------------------------------------------------------------
  // File selection + OCR
  // -------------------------------------------------------------------------
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setSelectedFile(file);

      // Auto-suggest name from filename
      if (!form.name) {
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        setForm((f) => ({ ...f, name: baseName }));
      }

      // OCR for images only (tesseract.js does not handle PDFs in-browser)
      if (file.type.startsWith("image/")) {
        setOcrLoading(true);
        try {
          const Tesseract = await import("tesseract.js");
          const worker = await Tesseract.createWorker("eng");
          const imageUrl = URL.createObjectURL(file);
          try {
            const { data: ocrResult } = await worker.recognize(imageUrl);
            const rawText = (ocrResult as any)?.text ?? "";
            setForm((f) => ({ ...f, ocr_text: rawText }));

            const extracted = extractFromOcrText(rawText);
            if (extracted.suggestedName && !form.name) {
              setForm((f) => ({ ...f, name: extracted.suggestedName! }));
            }
            if (extracted.amount !== null) {
              setForm((f) => ({ ...f, amount: String(extracted.amount) }));
            }
            if (extracted.expiryDate) {
              setForm((f) => ({ ...f, expiry_date: extracted.expiryDate! }));
            }
            if (extracted.licenceNumber) {
              setForm((f) => ({ ...f, licence_number: extracted.licenceNumber! }));
            }
            toast.success("OCR completed — review extracted fields before saving.");
          } finally {
            URL.revokeObjectURL(imageUrl);
            await worker.terminate();
          }
        } catch (err) {
          toast.warning("OCR could not process this image. You can fill fields manually.");
        } finally {
          setOcrLoading(false);
        }
      }
    },
    [form.name],
  );

  // -------------------------------------------------------------------------
  // Save (create or update)
  // -------------------------------------------------------------------------
  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Document name is required");
      return;
    }

    setSaving(true);

    try {
      let filePath = editing?.file_path ?? uploadedPath;
      let fileSize = editing?.file_size ?? 0;
      let contentType = editing?.content_type ?? null;

      // Upload file if a new one was selected
      if (selectedFile && !filePath) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const commaIdx = result.indexOf(",");
            resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(selectedFile);
        });

        const path = `documents/${Date.now()}-${selectedFile.name.replace(/[^a-zA-Z0-9.\-]/g, "_")}`;
        const uploadResult = await uploadFile({
          data: {
            bucket: "documents",
            path,
            contentType: selectedFile.type || "application/octet-stream",
            fileData: base64,
          },
        });

        if (!uploadResult.success) {
          toast.error(uploadResult.error ?? "File upload failed");
          setSaving(false);
          return;
        }
        filePath = uploadResult.path;
        fileSize = selectedFile.size;
        contentType = selectedFile.type;
      }

      if (!filePath) {
        toast.error("Please select a file to upload");
        setSaving(false);
        return;
      }

      const payload: any = {
        name: form.name.trim(),
        document_type: form.document_type,
        file_path: filePath,
        file_size: fileSize,
        content_type: contentType ?? undefined,
        amount: form.amount ? parseFloat(form.amount) : null,
        expiry_date: form.expiry_date || null,
        licence_number: form.licence_number || null,
        block_id: form.block_id || null,
        vendor_id: form.vendor_id || null,
        project_name: form.project_name || null,
        customer_name: form.customer_name || null,
        related_entity: form.related_entity || null,
        ocr_text: form.ocr_text || null,
        work_category: form.work_category,
      };

      if (editing) {
        const result = await updateDocument({ data: { id: editing.id, ...payload } as any });
        if (result.success) {
          toast.success("Document updated");
          queryClient.invalidateQueries({ queryKey: ["documents"] });
        } else {
          toast.error(result.error ?? "Failed to update document");
        }
      } else {
        const result = await createDocument({ data: payload as any });
        if (result.success) {
          toast.success("Document saved");
          queryClient.invalidateQueries({ queryKey: ["documents"] });
        } else {
          toast.error(result.error ?? "Failed to save document");
        }
      }

      setDialogOpen(false);
      setSaving(false);
    } catch (err) {
      toast.error("Unable to save document. Please try again.");
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  async function handleDelete(doc: DocumentRow) {
    if (!confirm(`Delete "${doc.name}"? This will also remove the file from storage.`)) return;
    const result = await deleteDocument({ data: { id: doc.id } });
    if (result.success) {
      toast.success("Document deleted");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } else {
      toast.error(result.error ?? "Failed to delete document");
    }
  }

  // -------------------------------------------------------------------------
  // Preview / Download
  // -------------------------------------------------------------------------
  async function handlePreview(doc: DocumentRow) {
    const result = await getDocumentUrl({ data: { id: doc.id } });
    if (result.success && result.url) {
      window.open(result.url, "_blank");
    } else {
      toast.error(result.error ?? "Failed to open document");
    }
  }

  async function handleDownload(doc: DocumentRow) {
    const result = await getDocumentUrl({ data: { id: doc.id, download: true } });
    if (result.success && result.url) {
      const a = window.document.createElement("a");
      a.href = result.url;
      a.download = doc.name;
      a.click();
    } else {
      toast.error(result.error ?? "Failed to download document");
    }
  }

  return (
    <AppShell
      title="Documents"
      subtitle="Centralized document storage — licences, certificates, agreements, bills & more"
    >
      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load documents: {error?.message ?? "Unknown error"}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, project, vendor, licence no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {DOCUMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={expiryFilter} onValueChange={setExpiryFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Expiry status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All expiry</SelectItem>
            {EXPIRY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map((v: any) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={blockFilter} onValueChange={setBlockFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All blocks" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All blocks</SelectItem>
            {blocks.map((b: any) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <WorkCategorySelect
          value={workCatFilter}
          onChange={setWorkCatFilter}
          placeholder="All categories"
          className="w-[160px]"
        />
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Upload Document
          </Button>
        )}
      </div>

      {/* Summary stats */}
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>
          Total: <span className="font-semibold text-foreground">{docsData?.total ?? 0}</span>
        </span>
        <span>
          Expiring Soon:{" "}
          <span className="font-semibold text-warning-foreground">
            {documents.filter((d: any) => d.expiry_status === "Expiring Soon").length}
          </span>
        </span>
        <span>
          Expired:{" "}
          <span className="font-semibold text-destructive">
            {documents.filter((d: any) => d.expiry_status === "Expired").length}
          </span>
        </span>
      </div>

      {/* Documents table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Work</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Related</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && documents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No documents found. {canEdit ? 'Click "Upload Document" to add one.' : ""}
                  </TableCell>
                </TableRow>
              )}
              {documents.map((doc: any) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate">{doc.name}</p>
                        {doc.licence_number && (
                          <p className="text-xs text-muted-foreground">Lic: {doc.licence_number}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">{doc.document_type}</span>
                  </TableCell>
                  <TableCell>
                    <WorkCategoryBadge category={doc.work_category} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusPill tone={expiryTone(doc.expiry_status)}>
                        {doc.expiry_status}
                      </StatusPill>
                      {doc.expiry_date && (
                        <span className="text-xs text-muted-foreground">
                          {formatDate(doc.expiry_date)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {doc.amount !== null ? inr(doc.amount) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {doc.project_name ?? doc.customer_name ?? doc.related_entity ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{doc.uploaded_by_name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(doc.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handlePreview(doc)}
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(doc)}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(doc)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(doc)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Document" : "Upload Document"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update document metadata. File will remain unchanged."
                : "Upload a document and optionally run OCR to auto-extract details."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* File upload */}
            {!editing && (
              <div>
                <Label>File</Label>
                <div
                  className="mt-1 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFile ? (
                    <div className="text-center">
                      <FileText className="mx-auto h-8 w-8 text-primary mb-2" />
                      <p className="text-sm font-medium">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">Click to select a file</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PDF, images, docs up to 10MB
                      </p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.heic,.heif,.xls,.xlsx,.doc,.docx,.csv,.txt,.zip"
                    onChange={handleFileSelect}
                  />
                </div>
                {ocrLoading && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <ScanText className="h-4 w-4 animate-pulse" />
                    Running OCR to extract text...
                  </div>
                )}
              </div>
            )}

            {/* Document Name */}
            <div>
              <Label>Document Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Building Licence — Block A"
              />
            </div>

            {/* Document Type */}
            <div>
              <Label>Document Type</Label>
              <Select
                value={form.document_type}
                onValueChange={(v) => setForm({ ...form, document_type: v as DocumentType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount & Expiry Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount (if applicable)</Label>
                <Input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Expiry Date (if applicable)</Label>
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </div>
            </div>

            {/* Licence Number */}
            <div>
              <Label>Licence / Registration Number</Label>
              <Input
                value={form.licence_number}
                onChange={(e) => setForm({ ...form, licence_number: e.target.value })}
                placeholder="e.g. BL-2024-00123"
              />
            </div>

            {/* Related entity fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Project / Site Name</Label>
                <Input
                  value={form.project_name}
                  onChange={(e) => setForm({ ...form, project_name: e.target.value })}
                  placeholder="e.g. Vgrand Hospital — Block A"
                />
              </div>
              <div>
                <Label>Customer Name</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  placeholder="e.g. Vgrand Healthcare"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Related Block</Label>
                <Select
                  value={form.block_id || "none"}
                  onValueChange={(v) => setForm({ ...form, block_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {blocks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Related Vendor</Label>
                <Select
                  value={form.vendor_id || "none"}
                  onValueChange={(v) => setForm({ ...form, vendor_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {vendors.map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Other Related Entity</Label>
              <Input
                value={form.related_entity}
                onChange={(e) => setForm({ ...form, related_entity: e.target.value })}
                placeholder="e.g. Labour Contractor — ABC Associates"
              />
            </div>

            <div>
              <Label>Work Category *</Label>
              <WorkCategorySelect
                value={form.work_category}
                onChange={(val) => setForm({ ...form, work_category: val })}
                placeholder="Select work category..."
              />
            </div>

            {/* OCR text (collapsible) */}
            {form.ocr_text && (
              <div>
                <Label>OCR Extracted Text (editable)</Label>
                <Textarea
                  value={form.ocr_text}
                  onChange={(e) => setForm({ ...form, ocr_text: e.target.value })}
                  rows={4}
                  className="text-xs font-mono"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Review and edit the extracted text. Fields above were auto-filled from this text.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              <X className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || ocrLoading}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Save Changes" : "Save Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
