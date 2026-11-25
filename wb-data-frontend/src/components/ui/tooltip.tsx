import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const mergedRef = React.useCallback(
    (node: React.ElementRef<typeof TooltipPrimitive.Content> | null) => {
      const popperWrapper = node?.closest<HTMLElement>("[data-radix-popper-content-wrapper]")
      if (popperWrapper) {
        popperWrapper.style.pointerEvents = "none"
      }
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref],
  )

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={mergedRef}
        sideOffset={sideOffset}
        className={cn(
          "pointer-events-none z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
