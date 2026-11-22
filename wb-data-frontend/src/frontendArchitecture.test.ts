import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(process.cwd(), 'src');

const FOUNDATION_LAYERS = new Set([
    'api',
    'components',
    'constants',
    'hooks',
    'lib',
    'types',
    'utils',
]);

const STATIC_OR_DYNAMIC_IMPORT_RE =
    /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function collectSourceFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectSourceFiles(fullPath));
            continue;
        }
        if (!entry.isFile()) continue;
        if (!(entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) continue;
        if (entry.name.includes('.test.') || entry.name.includes('.test-helper.')) continue;
        files.push(fullPath);
    }
    return files;
}

function extractSpecifiers(content: string): string[] {
    const specifiers: string[] = [];
    const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '');
    STATIC_OR_DYNAMIC_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STATIC_OR_DYNAMIC_IMPORT_RE.exec(stripped)) !== null) {
        const spec = match[1] ?? match[2];
        if (spec) specifiers.push(spec);
    }
    return specifiers;
}

function resolveImportToSrcRelative(importerRelPath: string, specifier: string): string | null {
    let rawTarget: string;
    if (specifier.startsWith('@/')) {
        rawTarget = specifier.slice(2);
    } else if (specifier.startsWith('.')) {
        const joined = resolve(SRC_ROOT, dirname(importerRelPath), specifier);
        rawTarget = relative(SRC_ROOT, joined).replace(/\\/g, '/');
    } else {
        return null;
    }

    const candidates = [
        rawTarget,
        `${rawTarget}.ts`,
        `${rawTarget}.tsx`,
        `${rawTarget}/index.ts`,
        `${rawTarget}/index.tsx`,
    ];
    for (const candidate of candidates) {
        const abs = resolve(SRC_ROOT, candidate);
        if (existsSync(abs) && statSync(abs).isFile()) {
            return candidate.replace(/\\/g, '/');
        }
    }
    return rawTarget.replace(/\\/g, '/');
}

function layerOf(srcRelPath: string): string {
    const parts = srcRelPath.split('/');
    if (parts[0] === 'views' && parts.length > 1) {
        return `views/${parts[1]}`;
    }
    return parts[0];
}

describe('frontend architecture boundaries', () => {
    it('prevents foundation layers from importing views', () => {
        const files = collectSourceFiles(SRC_ROOT);
        const violations: string[] = [];

        for (const file of files) {
            const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
            const srcLayer = layerOf(rel);
            if (!FOUNDATION_LAYERS.has(srcLayer)) continue;

            for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
                const resolved = resolveImportToSrcRelative(rel, spec);
                if (!resolved) continue;
                const targetLayer = layerOf(resolved);
                if (targetLayer.startsWith('views/')) {
                    violations.push(`${rel} (${srcLayer}) -> ${resolved} (${targetLayer})`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('prevents direct cross-view imports across feature domains', () => {
        const files = collectSourceFiles(SRC_ROOT);
        const violations: string[] = [];

        for (const file of files) {
            const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
            const srcLayer = layerOf(rel);
            if (!srcLayer.startsWith('views/')) continue;

            for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
                const resolved = resolveImportToSrcRelative(rel, spec);
                if (!resolved) continue;
                const targetLayer = layerOf(resolved);
                if (targetLayer.startsWith('views/') && targetLayer !== srcLayer) {
                    violations.push(`${rel} (${srcLayer}) -> ${resolved} (${targetLayer})`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('keeps src/api/offline submodules strictly acyclic', () => {
        const offlineApiDir = resolve(SRC_ROOT, 'api/offline');
        const files = collectSourceFiles(offlineApiDir);
        const graph = new Map<string, string[]>();

        for (const file of files) {
            const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
            const deps: string[] = [];
            for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
                const resolved = resolveImportToSrcRelative(rel, spec);
                if (resolved && resolved.startsWith('api/offline/') && resolved !== rel) {
                    deps.push(resolved);
                }
            }
            graph.set(rel, deps);
        }

        const visiting = new Set<string>();
        const visited = new Set<string>();
        const cycles: string[] = [];

        function dfs(node: string, stack: string[]) {
            visiting.add(node);
            for (const next of graph.get(node) ?? []) {
                if (visiting.has(next)) {
                    cycles.push([...stack, next].join(' -> '));
                } else if (!visited.has(next)) {
                    dfs(next, [...stack, next]);
                }
            }
            visiting.delete(node);
            visited.add(node);
        }

        for (const node of graph.keys()) {
            if (!visited.has(node)) {
                dfs(node, [node]);
            }
        }

        expect(cycles).toEqual([]);
    });
});
