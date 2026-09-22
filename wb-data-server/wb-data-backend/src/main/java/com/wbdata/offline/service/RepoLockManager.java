package com.wbdata.offline.service;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Supplier;

@Component
public class RepoLockManager {

    private final ConcurrentHashMap<Long, ReentrantLock> locks = new ConcurrentHashMap<>();
    private final ReentrantReadWriteLock graphLock = new ReentrantReadWriteLock(true);

    public <T> T withLock(Long groupId, Supplier<T> action) {
        // Always enter the graph gate before a group lock. A graph writer may reenter here.
        graphLock.readLock().lock();
        ReentrantLock lock = locks.computeIfAbsent(groupId, ignored -> new ReentrantLock());
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
            graphLock.readLock().unlock();
        }
    }

    /** Serializes full-graph validation and its save callback against all in-process repo operations. */
    public <T> T withGraphLock(Supplier<T> action) {
        if (graphLock.getReadHoldCount() > 0 && !graphLock.isWriteLockedByCurrentThread()) {
            throw new IllegalStateException("必须在获取项目组锁之前获取依赖图锁");
        }
        graphLock.writeLock().lock();
        try {
            return action.get();
        } finally {
            graphLock.writeLock().unlock();
        }
    }

    public void withLock(Long groupId, Runnable action) {
        withLock(groupId, () -> {
            action.run();
            return null;
        });
    }
}
