package com.wbdata.offline.repo.service;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * 离线仓库并发锁管理器：
 * - 项目组级 {@code withLock(groupId, ...)} 彼此隔离，互不阻塞读写与 Git 操作；
 * - 依赖拓扑变更互斥锁 {@code withGraphLock(...)} 仅用于新建、依赖/频率契约变更、删任务、删目录和回滚等慢路径；
 * - 强制保持「先 dependencyMutationLock、再 groupLock(groupId)」的固定加锁顺序以防止死锁。
 */
@Component
public class RepoLockManager {

    private final ConcurrentHashMap<Long, ReentrantLock> locks = new ConcurrentHashMap<>();
    private final ReentrantLock dependencyMutationLock = new ReentrantLock(true);
    private final ThreadLocal<Integer> groupLockDepth = ThreadLocal.withInitial(() -> 0);

    public <T> T withLock(Long groupId, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(groupId, ignored -> new ReentrantLock());
        lock.lock();
        int previousDepth = groupLockDepth.get();
        groupLockDepth.set(previousDepth + 1);
        try {
            return action.get();
        } finally {
            if (previousDepth == 0) {
                groupLockDepth.remove();
            } else {
                groupLockDepth.set(previousDepth);
            }
            lock.unlock();
        }
    }

    /** Serializes dependency topology mutations (graph validation + write) while keeping reads and other groups unblocked. */
    public <T> T withGraphLock(Supplier<T> action) {
        if (groupLockDepth.get() > 0 && !dependencyMutationLock.isHeldByCurrentThread()) {
            throw new IllegalStateException("必须在获取项目组锁之前获取依赖图锁");
        }
        dependencyMutationLock.lock();
        try {
            return action.get();
        } finally {
            dependencyMutationLock.unlock();
        }
    }

    public void withLock(Long groupId, Runnable action) {
        withLock(groupId, () -> {
            action.run();
            return null;
        });
    }
}
