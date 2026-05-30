package com.wbdata.offline.service;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class RepoLockManagerTest {

    @Test
    void serializesActionsForSameGroup() throws Exception {
        RepoLockManager manager = new RepoLockManager();
        CountDownLatch firstStarted = new CountDownLatch(1);
        CountDownLatch allowFirstToFinish = new CountDownLatch(1);
        List<String> events = java.util.Collections.synchronizedList(new ArrayList<>());

        try (var executor = Executors.newFixedThreadPool(2)) {
            executor.submit(() -> manager.withLock(1L, () -> {
                events.add("first-start");
                firstStarted.countDown();
                await(allowFirstToFinish);
                events.add("first-end");
            }));

            assertThat(firstStarted.await(1, TimeUnit.SECONDS)).isTrue();

            var second = executor.submit(() -> manager.withLock(1L, () -> events.add("second")));
            Thread.sleep(100);

            assertThat(second.isDone()).isFalse();
            allowFirstToFinish.countDown();
            second.get(1, TimeUnit.SECONDS);
        }

        assertThat(events).containsExactly("first-start", "first-end", "second");
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(1, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }
}
