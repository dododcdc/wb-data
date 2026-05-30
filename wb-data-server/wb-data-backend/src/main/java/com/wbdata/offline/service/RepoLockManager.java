package com.wbdata.offline.service;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

@Component
public class RepoLockManager {

    private final ConcurrentHashMap<Long, ReentrantLock> locks = new ConcurrentHashMap<>();

    public <T> T withLock(Long groupId, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(groupId, ignored -> new ReentrantLock());
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }

    public void withLock(Long groupId, Runnable action) {
        withLock(groupId, () -> {
            action.run();
            return null;
        });
    }
}
