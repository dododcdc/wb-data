import type { NodePosition } from '../../api/offline';

interface ViewportCenterInput {
    width: number;
    height: number;
    transform: string | null | undefined;
}

interface ViewportTransform {
    x: number;
    y: number;
    zoom: number;
}

function parseNumericList(value: string) {
    return value
        .split(',')
        .map((part) => Number.parseFloat(part.trim()))
        .filter((part) => Number.isFinite(part));
}

export function parseReactFlowViewportTransform(transform: string | null | undefined): ViewportTransform {
    if (!transform || transform === 'none') {
        return { x: 0, y: 0, zoom: 1 };
    }

    const matrix = transform.match(/^matrix\((.+)\)$/);
    if (matrix) {
        const values = parseNumericList(matrix[1]);
        return {
            x: values[4] ?? 0,
            y: values[5] ?? 0,
            zoom: values[0] && values[0] > 0 ? values[0] : 1,
        };
    }

    const translate = transform.match(/translate\(\s*([-.\d]+)px(?:,\s*([-.\d]+)px)?\s*\)/);
    const scale = transform.match(/scale\(\s*([-.\d]+)\s*\)/);
    const zoom = scale ? Number.parseFloat(scale[1]) : 1;
    return {
        x: translate ? Number.parseFloat(translate[1]) : 0,
        y: translate && translate[2] ? Number.parseFloat(translate[2]) : 0,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    };
}

export function resolveViewportCenterFlowPosition({
    width,
    height,
    transform,
}: ViewportCenterInput): NodePosition {
    const viewport = parseReactFlowViewportTransform(transform);
    return {
        x: (width / 2 - viewport.x) / viewport.zoom,
        y: (height / 2 - viewport.y) / viewport.zoom,
    };
}
