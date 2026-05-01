import * as React from "react"
import { AlertCircle, HelpCircle, AlertTriangle, CheckCircle } from "lucide-react"
import { Button } from "./button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive" | "warning" | "success" | "outline"
  onConfirm: () => void | Promise<void>
  isLoading?: boolean
  icon?: "info" | "warning" | "error" | "success" | "none"
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  onConfirm,
  isLoading,
  icon = "none",
}: ConfirmDialogProps) {
  const confirmButtonVariant: "default" | "destructive" | "outline" =
    variant === "warning" || variant === "success" ? "default" : variant

  const Icon = React.useMemo(() => {
    switch (icon) {
      case "info": return <HelpCircle className="text-blue-500" size={24} />
      case "warning": return <AlertTriangle className="text-amber-500" size={24} />
      case "error": return <AlertCircle className="text-red-500" size={24} />
      case "success": return <CheckCircle className="text-emerald-500" size={24} />
      default: return null
    }
  }, [icon])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: '440px' }}>
        <DialogHeader>
          <div className="flex items-start gap-4">
            {Icon && <div className="mt-1 shrink-0">{Icon}</div>}
            <div className="grid gap-1.5 flex-1">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription className="leading-relaxed">{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            type="button"
          >
            {cancelText}
          </Button>
          <Button
            variant={confirmButtonVariant}
            onClick={async () => {
              await onConfirm()
            }}
            disabled={isLoading}
            className={variant === "warning" ? "bg-amber-600 hover:bg-amber-700 text-white border-none" : ""}
            type="button"
          >
            {isLoading ? "处理中..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
