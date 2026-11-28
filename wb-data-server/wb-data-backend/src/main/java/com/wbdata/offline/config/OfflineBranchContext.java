package com.wbdata.offline.config;

import org.springframework.lang.Nullable;

import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * 离线工作台按请求/任务维度的活跃分支上下文。
 * 绑定某个 project group 当前操作对应的 Git worktree 路径与分支名，使同组多个分支可以并发读写、提交与试跑，互不阻塞。
 */
public final class OfflineBranchContext {

    public static final String HEADER_NAME = "X-Offline-Branch";
    public static final String MAIN_BRANCH = "main";

    public record Workspace(Long groupId, String branch, Path worktreePath) {
    }

    private static final ThreadLocal<Deque<Workspace>> STACK = ThreadLocal.withInitial(ArrayDeque::new);

    private OfflineBranchContext() {
    }

    public static void push(Long groupId, @Nullable String branch, @Nullable Path worktreePath) {
        if (groupId == null) {
            return;
        }
        STACK.get().push(new Workspace(groupId, normalizeBranch(branch), worktreePath));
    }

    public static void pop() {
        Deque<Workspace> deque = STACK.get();
        if (!deque.isEmpty()) {
            deque.pop();
        }
        if (deque.isEmpty()) {
            STACK.remove();
        }
    }

    public static <T> T withWorkspace(Long groupId,
                                      @Nullable String branch,
                                      @Nullable Path worktreePath,
                                      Supplier<T> action) {
        push(groupId, branch, worktreePath);
        try {
            return action.get();
        } finally {
            pop();
        }
    }

    public static void withWorkspace(Long groupId,
                                     @Nullable String branch,
                                     @Nullable Path worktreePath,
                                     Runnable action) {
        push(groupId, branch, worktreePath);
        try {
            action.run();
        } finally {
            pop();
        }
    }

    @Nullable
    public static Path currentWorktreePath(@Nullable Long groupId) {
        if (groupId == null) {
            return null;
        }
        Workspace top = STACK.get().peek();
        if (top == null || !Objects.equals(top.groupId(), groupId)) {
            return null;
        }
        return top.worktreePath();
    }

    @Nullable
    public static String currentBranch(@Nullable Long groupId) {
        if (groupId == null) {
            return null;
        }
        Workspace top = STACK.get().peek();
        if (top == null || !Objects.equals(top.groupId(), groupId)) {
            return null;
        }
        return top.branch();
    }

    public static void clear() {
        STACK.remove();
    }

    @Nullable
    private static String normalizeBranch(@Nullable String branch) {
        if (branch == null) {
            return null;
        }
        String trimmed = branch.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
