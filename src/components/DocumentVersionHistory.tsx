// Reusable Document Version History dialog component.
// Shows version history for a given entity (requisition, batch, vendor, gate_pass, inspection).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchDocumentVersions } from "@/lib/api/system-robustness-client";
import { History, Loader2, FileText, CheckCircle2, XCircle } from "lucide-react";

interface DocumentVersionHistoryProps {
  entityType: string;
  entityId: string;
  fieldName?: string;
  label?: string;
}

export function DocumentVersionHistory({
  entityType,
  entityId,
  fieldName,
  label = "Version History",
}: DocumentVersionHistoryProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["document-versions", entityType, entityId, fieldName],
    queryFn: () =>
      fetchDocumentVersions({
        data: {
          entity_type: entityType,
          entity_id: entityId,
          ...(fieldName ? { field_name: fieldName } : {}),
        },
      }),
    enabled: open,
  });
  const versions = (data as any)?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
          <History className="size-3.5" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Document Version History</DialogTitle>
          <DialogDescription>
            All versions of documents uploaded for this record. Superseded versions are kept for
            audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto py-2">
          {isLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No document versions recorded.
            </p>
          ) : (
            <div className="space-y-2">
              {versions.map((v: any) => (
                <div
                  key={v.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    v.superseded
                      ? "border-border bg-muted/30 opacity-60"
                      : "border-primary/30 bg-primary/5"
                  }`}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">v{v.version}</span>
                      {v.superseded ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <XCircle className="size-3" /> superseded
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="size-3" /> current
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {v.file_name ?? v.file_path}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Uploaded by {v.uploader?.name ?? "Unknown"} on{" "}
                      {new Date(v.uploaded_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                    {v.notes && (
                      <p className="mt-1 text-xs italic text-muted-foreground">{v.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
