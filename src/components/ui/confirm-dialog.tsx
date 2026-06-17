import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <AlertDialog.Popup className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl">
            <AlertDialog.Title className="text-base font-semibold">
              {title}
            </AlertDialog.Title>
            {description && (
              <AlertDialog.Description className="mt-1.5 text-sm text-muted-foreground">
                {description}
              </AlertDialog.Description>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="outline" size="sm" />}>
                Cancel
              </AlertDialog.Close>
              <AlertDialog.Close
                render={<Button variant="destructive" size="sm" />}
                onClick={onConfirm}
              >
                {confirmLabel}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
