import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '../../lib/utils';

const ResizablePanelGroup = ({
  className,
  direction,
  autoSaveId,
  orientation = direction || 'horizontal',
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group> & {
  direction?: 'horizontal' | 'vertical';
  autoSaveId?: string;
}) => (
  <ResizablePrimitive.Group
    id={autoSaveId}
    className={cn(
      'flex h-full w-full',
      orientation === 'vertical' && 'flex-col',
      className
    )}
    orientation={orientation}
    {...props}
  />
);

// Convert numeric minSize/maxSize/collapsedSize to percentage strings.
// react-resizable-panels v4 treats numbers as px, but this project's
// legacy allotment API used numbers as percentages (0–100).
type ResizablePanelProps = React.ComponentProps<typeof ResizablePrimitive.Panel> & {
  order?: number;
};

const ResizablePanel = ({
  minSize,
  maxSize,
  collapsedSize,
  order,
  ...props
}: ResizablePanelProps) => {
  void order;

  return (
    <ResizablePrimitive.Panel
      minSize={typeof minSize === 'number' ? `${minSize}%` : minSize}
      maxSize={typeof maxSize === 'number' ? `${maxSize}%` : maxSize}
      collapsedSize={typeof collapsedSize === 'number' ? `${collapsedSize}%` : collapsedSize}
      {...props}
    />
  );
};

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      'relative flex w-px items-center justify-center bg-border transition-colors duration-200 after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:translate-y-1/2',
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
