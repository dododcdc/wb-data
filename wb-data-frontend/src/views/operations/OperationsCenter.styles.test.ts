import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const table = readFileSync(resolve(process.cwd(), 'src/views/operations/OperationsTable.tsx'), 'utf8');
const listStyles = readFileSync(resolve(process.cwd(), 'src/components/ui/list/list.css'), 'utf8');

describe('OperationsCenter table layout', () => {
    it('uses the compact shared list and includes the end time column', () => {
        expect(table).toContain('className="wb-list-compact"');
        expect(table).toContain('minWidth="1240px"');
        expect(table).toContain('结束时间');
        expect(table).toContain('row.endDate');
        expect(listStyles).toContain('.wb-list-compact .wb-list-table td');
        expect(listStyles).toMatch(/\.wb-list-compact \.wb-list-table td\s*\{[^}]*height:\s*40px/s);
    });
});
