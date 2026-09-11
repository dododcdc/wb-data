import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionTimeContextDialog } from './ExecutionTimeContextDialog';

function TestDialog() {
    const [overrides, setOverrides] = useState<Record<string, string>>({});
    return (
        <ExecutionTimeContextDialog
            open
            timezone="Asia/Shanghai"
            parameterKeys={[]}
            definitions={[{
                key: 'tenant_name',
                valueSource: 'CONSTANT',
                constantValue: 'tom',
                offsetDays: 0,
                sortOrder: 0,
            }]}
            plannedTime=""
            parameterOverrides={overrides}
            pending={false}
            onOpenChange={vi.fn()}
            onPlannedTimeChange={vi.fn()}
            onParameterOverridesChange={setOverrides}
            onConfirm={vi.fn()}
        />
    );
}

describe('ExecutionTimeContextDialog', () => {
    it('distinguishes an empty-string override from no override', () => {
        render(<TestDialog />);

        fireEvent.click(screen.getByRole('button', { name: /参数临时覆盖/ }));
        const enabled = screen.getByRole('checkbox', { name: '覆盖参数 tenant_name' });
        const value = screen.getByLabelText('参数 tenant_name 覆盖值');

        expect((value as HTMLInputElement).disabled).toBe(true);
        fireEvent.click(enabled);
        expect((value as HTMLInputElement).disabled).toBe(false);
        expect(screen.getByText('已覆盖 1 项')).toBeTruthy();

        fireEvent.change(value, { target: { value: 'jack' } });
        fireEvent.change(value, { target: { value: '' } });
        expect((enabled as HTMLInputElement).checked).toBe(true);
        expect(screen.getByText('已覆盖 1 项')).toBeTruthy();

        fireEvent.click(enabled);
        expect((value as HTMLInputElement).disabled).toBe(true);
        expect(screen.queryByText('已覆盖 1 项')).toBeNull();
    });
});
