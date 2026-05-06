import { AlertTriangle, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from './button';
import './unsaved-changes-dialog.css';

interface UnsavedChangesDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: () => void;
    onDiscard: () => void;
}

/**
 * A specialized confirmation dialog for unsaved changes.
 * Follows the design-md aesthetic with premium spacing and alignment.
 */
export function UnsavedChangesDialog({
    open,
    onOpenChange,
    onSave,
    onDiscard
}: UnsavedChangesDialogProps) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="dialog-overlay" />
                <div className="dialog-positioner">
                    <DialogPrimitive.Content className="dialog-content uc-dialog-content">
                        <div className="uc-header">
                            <div className="uc-icon-box" aria-hidden="true">
                                <AlertTriangle size={22} />
                            </div>
                            <div className="uc-title-group">
                                <DialogPrimitive.Title className="uc-title">
                                    您有未保存的更改
                                </DialogPrimitive.Title>
                            </div>
                        </div>

                        <div className="uc-body">
                            <DialogPrimitive.Description className="uc-description">
                                离开此页面将导致所有未保存的修改丢失。您希望在离开前保存当前 Flow 的修改吗？
                            </DialogPrimitive.Description>
                        </div>

                        <div className="uc-footer">
                            <Button 
                                variant="ghost" 
                                type="button"
                                className="btn-cancel"
                                onClick={() => onOpenChange(false)}
                            >
                                取消
                            </Button>
                            <Button 
                                variant="outline" 
                                type="button"
                                className="btn-discard"
                                onClick={onDiscard}
                            >
                                放弃修改
                            </Button>
                            <Button 
                                variant="default"
                                type="button"
                                onClick={onSave}
                            >
                                保存并离开
                            </Button>
                        </div>

                        <DialogPrimitive.Close className="uc-close-btn" aria-label="关闭">
                            <X size={18} />
                        </DialogPrimitive.Close>
                    </DialogPrimitive.Content>
                </div>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
