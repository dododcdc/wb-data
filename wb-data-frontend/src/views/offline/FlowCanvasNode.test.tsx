import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FlowCanvasNode } from './FlowCanvasNode';
import './OfflineWorkbench.css';

vi.mock('@xyflow/react', () => ({
    Handle: () => <div data-testid="flow-handle" />,
    Position: {
        Top: 'top',
        Bottom: 'bottom',
    },
}));

vi.mock('../../components/ui/tooltip', async () => {
    const ReactModule = await import('react');

    const TooltipContext = ReactModule.createContext<{
        open: boolean;
        onOpenChange?: (open: boolean) => void;
    }>({ open: false });

    return {
        TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        Tooltip: ({
            open = false,
            onOpenChange,
            children,
        }: {
            open?: boolean;
            onOpenChange?: (open: boolean) => void;
            children: React.ReactNode;
        }) => (
            <TooltipContext.Provider value={{ open, onOpenChange }}>
                {children}
            </TooltipContext.Provider>
        ),
        TooltipTrigger: ({
            asChild,
            children,
        }: {
            asChild?: boolean;
            children: React.ReactElement;
        }) => {
            const context = ReactModule.useContext(TooltipContext);
            const child = ReactModule.Children.only(children);

            if (!asChild) {
                return child;
            }

            return ReactModule.cloneElement(child, {
                onMouseEnter: (event: React.MouseEvent) => {
                    child.props.onMouseEnter?.(event);
                    context.onOpenChange?.(true);
                },
                onMouseLeave: (event: React.MouseEvent) => {
                    child.props.onMouseLeave?.(event);
                    context.onOpenChange?.(false);
                },
            });
        },
        TooltipContent: ({
            children,
        }: {
            children: React.ReactNode;
        }) => {
            const context = ReactModule.useContext(TooltipContext);
            return context.open ? <div role="tooltip">{children}</div> : null;
        },
    };
});

describe('FlowCanvasNode', () => {
    afterEach(() => {
        cleanup();
    });

    it('shows the node kind as text without rendering a separate type icon', () => {
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'build_mart',
                    kind: 'SQL',
                    selected: false,
                    onToggleSelection: vi.fn(),
                }}
            />,
        );

        expect(screen.getByText('build_mart')).not.toBeNull();
        expect(screen.getByText('SQL')).not.toBeNull();
        expect(container.querySelector('.flow-canvas-node-icon')).toBeNull();
    });

    it('edits the node name inline without rendering a nested input', () => {
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'build_mart',
                    kind: 'SQL',
                    selected: false,
                    isEditing: true,
                    onToggleSelection: vi.fn(),
                    onRename: vi.fn(),
                    onCancelRename: vi.fn(),
                }}
            />,
        );

        const editableLabel = container.querySelector('.flow-canvas-node-label.is-editing') as HTMLElement | null;

        expect(container.querySelector('.flow-canvas-node-input')).toBeNull();
        expect(editableLabel).not.toBeNull();
        expect(editableLabel?.getAttribute('contenteditable')).toBe('true');
        expect(document.getSelection()?.toString()).toBe('build_mart');
    });

    it('uses the shared tooltip flow instead of a native title attribute', () => {
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'build_mart',
                    kind: 'SQL',
                    selected: false,
                    onToggleSelection: vi.fn(),
                }}
            />,
        );

        const label = container.querySelector('.flow-canvas-node-label') as HTMLElement;
        fireEvent.mouseEnter(label);

        expect(label.getAttribute('title')).toBeNull();
    });

    it('does not show a tooltip when the full node name is already visible', async () => {
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'short_name',
                    kind: 'SQL',
                    selected: false,
                    onToggleSelection: vi.fn(),
                }}
            />,
        );

        const label = container.querySelector('.flow-canvas-node-label') as HTMLElement;
        Object.defineProperty(label, 'clientWidth', { configurable: true, value: 120 });
        Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 120 });

        fireEvent.mouseEnter(label);

        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).toBeNull();
        });
    });

    it('shows a tooltip only when the node name is truncated', async () => {
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'this_is_a_very_long_node_name',
                    kind: 'SQL',
                    selected: false,
                    onToggleSelection: vi.fn(),
                }}
            />,
        );

        const label = container.querySelector('.flow-canvas-node-label') as HTMLElement;
        Object.defineProperty(label, 'clientWidth', { configurable: true, value: 120 });
        Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 240 });

        fireEvent.mouseEnter(label);

        await waitFor(() => {
            expect(screen.getByRole('tooltip')).not.toBeNull();
        });
    });

    it('does not re-render on every keystroke while inline editing', () => {
        const onRender = vi.fn();
        const { container } = render(
            <Profiler id="flow-node" onRender={onRender}>
                <FlowCanvasNode
                    data={{
                        taskId: 'build_mart',
                        kind: 'SQL',
                        selected: false,
                        isEditing: true,
                        onToggleSelection: vi.fn(),
                        onRename: vi.fn(),
                        onCancelRename: vi.fn(),
                    }}
                />
            </Profiler>,
        );

        const initialCommitCount = onRender.mock.calls.length;
        const editableLabel = container.querySelector('.flow-canvas-node-label.is-editing') as HTMLElement;

        editableLabel.textContent = 'build_mar';
        fireEvent.input(editableLabel, {
            currentTarget: editableLabel,
            target: editableLabel,
        });

        expect(onRender).toHaveBeenCalledTimes(initialCommitCount);
    });

    it('does not commit rename when Enter is pressed during IME composition', () => {
        const onRename = vi.fn();
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'build_mart',
                    kind: 'SQL',
                    selected: false,
                    isEditing: true,
                    onToggleSelection: vi.fn(),
                    onRename,
                    onCancelRename: vi.fn(),
                }}
            />,
        );

        const editableLabel = container.querySelector('.flow-canvas-node-label.is-editing') as HTMLElement;

        fireEvent.compositionStart(editableLabel);
        fireEvent.keyDown(editableLabel, {
            key: 'Enter',
            nativeEvent: { isComposing: true },
        });

        expect(onRename).not.toHaveBeenCalled();
    });

    it('keeps a fixed node width even when the name is long', () => {
        const { container } = render(
            <FlowCanvasNode
                data={{
                    taskId: 'this_is_a_very_long_node_name_that_should_not_expand_the_card',
                    kind: 'SQL',
                    selected: false,
                    onToggleSelection: vi.fn(),
                }}
            />,
        );

        const node = container.querySelector('.flow-canvas-node') as HTMLElement;
        const styles = window.getComputedStyle(node);

        expect(styles.width).not.toBe('auto');
        expect(styles.maxWidth).not.toBe('none');
    });
});
