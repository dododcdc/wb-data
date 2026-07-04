import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function cssBlock(css: string, selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Array.from(css.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'g')))
        .map((match) => match[0])
        .join('\n');
}

describe('OfflineWorkbench layout guardrails', () => {
    it('keeps the rail toolbar above the canvas toolbar at narrow widths', () => {
        const css = readFileSync(join(process.cwd(), 'src/views/offline/OfflineWorkbench.css'), 'utf8');
        const railBlock = cssBlock(css, '.offline-rail');
        const mainPanelBlock = cssBlock(css, '.offline-main-panel');
        const railActionsBlock = cssBlock(css, '.offline-rail-toolbar-actions');

        expect(railBlock).toContain('position: relative');
        expect(railBlock).toContain('z-index: 2');
        expect(mainPanelBlock).toContain('position: relative');
        expect(mainPanelBlock).toContain('z-index: 1');
        expect(mainPanelBlock).toContain('min-width: 0');
        expect(railActionsBlock).toContain('flex: 0 0 auto');
    });
});
