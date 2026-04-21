type Edge = { source: string; target: string };

type Input = { nodeIds: string[]; edges: Edge[] };

export function hasImplicitDependenciesAfterSaveRoundTrip({ nodeIds, edges }: Input): boolean {
    const nodes = new Set(nodeIds);
    const adj = new Map<string, string[]>();
    const incoming = new Map<string, number>();

    for (const id of nodeIds) {
        adj.set(id, []);
        incoming.set(id, 0);
    }

    for (const e of edges) {
        if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
        adj.get(e.source)!.push(e.target);
        incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
    }

    // Kahn's algorithm for topological sort
    const q: string[] = [];
    for (const [id, cnt] of incoming) {
        if (cnt === 0) q.push(id);
    }

    const topo: string[] = [];
    while (q.length) {
        const n = q.shift()!;
        topo.push(n);
        for (const m of adj.get(n) ?? []) {
            incoming.set(m, (incoming.get(m) || 0) - 1);
            if (incoming.get(m) === 0) q.push(m);
        }
    }

    if (topo.length !== nodeIds.length) {
        // Graph isn't a DAG (or nodes missing). Spec expects a DAG; avoid false positives conservatively.
        return false;
    }

    // Longest-path layering: layer[node] = max length from any source to node
    const layer = new Map<string, number>();
    for (const id of nodeIds) layer.set(id, 0);

    for (const u of topo) {
        const uLayer = layer.get(u) ?? 0;
        for (const v of adj.get(u) ?? []) {
            layer.set(v, Math.max(layer.get(v) ?? 0, uLayer + 1));
        }
    }

    // Use a nested map for edge existence to avoid delimiter collisions when
    // joining source and target strings.
    const edgeMap = new Map<string, Set<string>>();
    for (const e of edges) {
        if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
        let targets = edgeMap.get(e.source);
        if (!targets) {
            targets = new Set<string>();
            edgeMap.set(e.source, targets);
        }
        targets.add(e.target);
    }

    // If any pair of nodes on adjacent layers (source layer +1 == target layer)
    // lacks an explicit edge, that dependency would become implicit after save
    for (const s of nodeIds) {
        for (const t of nodeIds) {
            if (s === t) continue;
            const ls = layer.get(s) ?? 0;
            const lt = layer.get(t) ?? 0;
            if (ls + 1 === lt) {
                if (!(edgeMap.get(s)?.has(t))) return true;
            }
        }
    }

    return false;
}
