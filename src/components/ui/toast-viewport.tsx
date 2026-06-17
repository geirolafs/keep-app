import { Toast } from "@base-ui/react/toast";
import { cn } from "@/lib/utils";

export function ToastList() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2 outline-none">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          toast={toast}
          className={cn(
            "flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm",
            toast.type === "success" &&
              "border-green-600/30 bg-green-950/90 text-green-50",
            toast.type === "error" &&
              "border-red-500/30 bg-red-950/90 text-red-50",
            (!toast.type || toast.type === "default") &&
              "border-border bg-popover text-popover-foreground",
          )}
        >
          <Toast.Content className="flex min-w-0 flex-col gap-0.5">
            {toast.title && (
              <Toast.Title className="font-medium leading-snug">
                {toast.title}
              </Toast.Title>
            )}
            {toast.description && (
              <Toast.Description className="text-xs opacity-70">
                {toast.description}
              </Toast.Description>
            )}
          </Toast.Content>
          <Toast.Close className="shrink-0 leading-none opacity-50 transition-opacity hover:opacity-80">
            ×
          </Toast.Close>
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}
