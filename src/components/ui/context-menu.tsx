import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { cn } from "@/lib/utils"

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner>
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg text-sm text-popover-foreground",
            "origin-[var(--transform-origin)] transition-[opacity,transform] duration-[150ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            "data-[ending-style]:duration-[100ms]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
            className
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "flex items-center px-3 py-1.5 rounded-md outline-none select-none cursor-default",
        variant === "destructive"
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border/50", className)}
      {...props}
    />
  )
}

function ContextMenuLabel({ className, ...props }: ContextMenuPrimitive.GroupLabel.Props) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      className={cn("px-3 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
}
