import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParameterPreviewGrid, type ParameterPreviewItem } from './ParameterPreviewGrid';

const items: ParameterPreviewItem[] = [
    {
        key: 'tenant_name',
        description: '租户名称',
        valueSource: 'CONSTANT',
        timeBasis: null,
        ruleText: '"小明"',
        value: '小明',
    },
    {
        key: 'v_day',
        description: '业务日期',
        valueSource: 'SYSTEM_TIME',
        timeBasis: 'PLANNED_TIME',
        ruleText: '计划时间 (yyyyMMdd)',
        value: '20260815',
    },
];

describe('ParameterPreviewGrid', () => {
    it('renders parameter identity, source rules and resolved values', () => {
        const { container } = render(<ParameterPreviewGrid items={items} />);

        expect(screen.getByRole('table', { name: '参数预览列表' })).toBeTruthy();
        expect(screen.getByText('tenant_name')).toBeTruthy();
        expect(screen.getByText('租户名称')).toBeTruthy();
        expect(screen.getByText('固定值')).toBeTruthy();
        expect(screen.getByText('"小明"')).toBeTruthy();
        expect(screen.getByText('v_day')).toBeTruthy();
        expect(screen.getByText('运行时日期')).toBeTruthy();
        expect(screen.getByText('计划时间 (yyyyMMdd)')).toBeTruthy();
        expect(screen.getByTitle('20260815')).toBeTruthy();
        expect(container.querySelector('.wb-parameter-preview-grid')).toBeTruthy();
        expect(container.querySelector('.wb-list-pagination')).toBeNull();
    });
});
