package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.offline.mapper.ExecutionParameterSnapshotMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ExecutionParameterSnapshotRegistryTest {

    @Test
    void registersContentAddressedSnapshotAndReadsItBack() {
        ExecutionParameterSnapshotMapper mapper = mock(ExecutionParameterSnapshotMapper.class);
        ExecutionParameterSnapshotRegistry registry = new ExecutionParameterSnapshotRegistry(mapper, new ObjectMapper());
        FlowParameterSnapshot snapshot = snapshot();

        String snapshotId = registry.register(4L, snapshot);

        assertThat(snapshotId).matches("[a-f0-9]{64}");
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(mapper).insertIgnore(
                org.mockito.ArgumentMatchers.eq(4L),
                org.mockito.ArgumentMatchers.eq(snapshotId),
                json.capture());
        when(mapper.findJson(4L, snapshotId)).thenReturn(json.getValue());
        assertThat(registry.find(4L, snapshotId)).contains(snapshot);
    }

    private FlowParameterSnapshot snapshot() {
        return new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "name", "CONSTANT", "小明", null, 0, null, 0, null)
        ));
    }
}
