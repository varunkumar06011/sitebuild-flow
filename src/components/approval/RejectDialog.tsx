// Reusable reject confirmation dialog that captures an optional rejection reason.
// Used by the approvals page and role dashboards to ensure rejection reason is always recorded.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, X } from "lucide-react";

export type RejectDialogProps = {
  open: boolean;
  prNumber: string;
  title: string;
  processing: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

// RejectDialog — modal prompting for a rejection reason before sending a requisition back.
export function RejectDialog({
  open,
  prNumber,
  title,
  processing,
  onConfirm,
  onCancel,
}: RejectDialogProps) {
  const [reason, setReason] = useState("");

  // Reset the reason field each time the dialog opens.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {prNumber}?</DialogTitle>
          <DialogDescription>
            "{title}" will be sent back to the supervisor for rework. Provide a reason (optional).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="reject-reason">Rejection reason</Label>
            <Input
              id="reject-reason"
              placeholder="e.g. Quotation too high — negotiate lower rate"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !processing) onConfirm(reason);
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={processing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={processing}>
            {processing ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Reject &amp; send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
