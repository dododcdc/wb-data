import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOperationFeedback, useFeedbackStore } from './useOperationFeedback';

describe('useOperationFeedback', () => {
    beforeEach(() => {
        useFeedbackStore.setState({ current: null, timerId: null });
        vi.useFakeTimers();
    });

    it('showFeedback shows success toast with default duration', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'success', title: '成功', detail: '' });
        expect(useFeedbackStore.getState().current?.title).toBe('成功');
    });

    it('showFeedback auto-dismisses after default duration', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'error', title: '失败', detail: '' });
        vi.advanceTimersByTime(5000);
        expect(useFeedbackStore.getState().current).toBeNull();
    });

    it('showFeedback uses custom duration when provided', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'error', title: '失败', detail: '' }, 10000);
        vi.advanceTimersByTime(5000);
        expect(useFeedbackStore.getState().current).not.toBeNull();
        vi.advanceTimersByTime(5000);
        expect(useFeedbackStore.getState().current).toBeNull();
    });

    it('showSuccess is a convenience for success toast', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showSuccess('操作成功');
        expect(useFeedbackStore.getState().current).toEqual({
            tone: 'success',
            title: '操作成功',
            detail: '',
        });
    });

    it('showSuccess accepts optional detail', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showSuccess('操作成功', '详情说明');
        expect(useFeedbackStore.getState().current).toEqual({
            tone: 'success',
            title: '操作成功',
            detail: '详情说明',
        });
    });

    it('showError extracts message from Error object', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showError(new Error('网络错误'), '操作失败');
        expect(useFeedbackStore.getState().current).toEqual({
            tone: 'error',
            title: '操作失败',
            detail: '网络错误',
        });
    });

    it('showError uses fallback title when error has no message', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showError({}, '操作失败');
        expect(useFeedbackStore.getState().current).toEqual({
            tone: 'error',
            title: '操作失败',
            detail: '操作失败',
        });
    });

    it('dismissFeedback clears toast', () => {
        const { result } = renderHook(() => useOperationFeedback());
        result.current.showFeedback({ tone: 'info', title: '信息', detail: '' });
        result.current.dismissFeedback();
        expect(useFeedbackStore.getState().current).toBeNull();
    });
});
