import * as React from "react"
import { Group, Panel, Separator } from "react-resizable-panels"
import { GripVertical } from "lucide-react"

import { cn } from "@/lib/utils"

type ResizablePanelGroupProps = React.ComponentProps<typeof Group> & {
  direction?: "horizontal" | "vertical"
}

const ResizablePanelGroup = ({
  className,
  direction,
  orientation,
  ...props
}: ResizablePanelGroupProps) => (
  <Group
    orientation={direction ?? orientation}
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
)
ResizablePanelGroup.displayName = "ResizablePanelGroup"

const ResizablePanel = Panel

type ResizableHandleProps = React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}

const ResizableHandle = ({
  className,
  withHandle = false,
  ...props
}: ResizableHandleProps) => (
  <Separator
    className={cn("relative flex items-center justify-center flex-shrink-0 select-none", className)}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
)
ResizableHandle.displayName = "ResizableHandle"

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
