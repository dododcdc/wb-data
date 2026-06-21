import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/views/operations/OperationsCenter.css'), 'utf8');

function readColumnWidth(className: string): number {
    const match = styles.match(new RegExp(`\\.${className}\\s*\\{[^}]*width:\\s*([\\d.]+)%`, 's'));
    return Number(match?.[1]);
}

describe('OperationsCenter table layout', () => {
    it('reserves non-overlapping width for second-precision timestamps', () => {
        const minWidth = Number(styles.match(/\.operations-table table\s*\{[^}]*min-width:\s*(\d+)px/s)?.[1]);
        const timeWidth = readColumnWidth('operations-col-time');
        const totalWidth =
            readColumnWidth('operations-col-task')
            + readColumnWidth('operations-col-branch')
            + readColumnWidth('operations-col-status')
            + timeWidth * 3
            + readColumnWidth('operations-col-duration')
            + readColumnWidth('operations-col-actions');

        expect(minWidth).toBeGreaterThanOrEqual(1360);
        expect(timeWidth).toBeGreaterThanOrEqual(13);
        expect(totalWidth).toBe(100);
        expect(styles).not.toContain('operations-col-failure');
    });
});
