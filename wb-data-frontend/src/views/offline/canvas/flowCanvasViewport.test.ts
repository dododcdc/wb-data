import { describe, expect, it } from 'vitest';
import {
    parseReactFlowViewportTransform,
    resolveViewportCenterFlowPosition,
} from './flowCanvasViewport';

describe('flowCanvasViewport', () => {
    it('parses ReactFlow translate scale transforms', () => {
        expect(parseReactFlowViewportTransform('translate(120px, -40px) scale(0.5)')).toEqual({
            x: 120,
            y: -40,
            zoom: 0.5,
        });
    });

    it('parses computed matrix transforms', () => {
        expect(parseReactFlowViewportTransform('matrix(1.25, 0, 0, 1.25, -300, 80)')).toEqual({
            x: -300,
            y: 80,
            zoom: 1.25,
        });
    });

    it('converts the visible viewport center into flow coordinates', () => {
        expect(resolveViewportCenterFlowPosition({
            width: 1000,
            height: 600,
            transform: 'translate(-200px, 100px) scale(2)',
        })).toEqual({
            x: 350,
            y: 100,
        });
    });
});
