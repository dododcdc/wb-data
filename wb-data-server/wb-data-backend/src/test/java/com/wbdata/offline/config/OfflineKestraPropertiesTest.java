package com.wbdata.offline.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineKestraPropertiesTest {

    @Test
    void transferRuntimeProperties_haveSafeDefaultNamesAndRuntimeSettings() {
        OfflineTransferProperties properties = new OfflineTransferProperties();

        assertThat(properties.getSeatunnelImage()).isEqualTo("apache/seatunnel:2.3.13");
        assertThat(properties.getDockerNetwork()).isEqualTo("wb-data-integration");
        assertThat(properties.getInternalBaseUrlEnv()).isEqualTo("WB_DATA_INTERNAL_BASE_URL");
        assertThat(properties.getInternalTokenEnv()).isEqualTo("WB_DATA_INTERNAL_TOKEN");
    }

    @Test
    void buildDebugNamespace_includesBranchKeyAndStaysWithinKestraLimit() {
        OfflineKestraProperties properties = new OfflineKestraProperties();
        String longBranchName = "feature/" + "very-long-branch-name-with-symbols_".repeat(6);

        String namespace = properties.buildDebugNamespace(Long.MAX_VALUE, Long.MAX_VALUE, longBranchName);

        assertThat(namespace).startsWith("wb-debug-g" + Long.MAX_VALUE + "-b");
        assertThat(namespace).endsWith("-u" + Long.MAX_VALUE);
        assertThat(namespace.length()).isLessThanOrEqualTo(150);
    }

    @Test
    void buildDebugNamespace_usesHashSuffixToAvoidSlugCollisions() {
        OfflineKestraProperties properties = new OfflineKestraProperties();

        String first = properties.buildDebugNamespace(1L, 2L, "feature/a_b");
        String second = properties.buildDebugNamespace(1L, 2L, "feature/a-b");

        assertThat(first).isNotEqualTo(second);
        assertThat(first).matches("wb-debug-g1-bfeature-a-b-[a-f0-9]{8}-u2");
        assertThat(second).matches("wb-debug-g1-bfeature-a-b-[a-f0-9]{8}-u2");
    }
}
