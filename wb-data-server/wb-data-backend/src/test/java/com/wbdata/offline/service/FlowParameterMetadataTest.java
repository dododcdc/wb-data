package com.wbdata.offline.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FlowParameterMetadataTest {

    @Test
    void declaresInput_findsDeclaredInput() {
        String source = """
                id: daily
                namespace: g4-main
                inputs:
                  - id: wbdata_planned_time
                    type: DATETIME
                    required: false
                  - id: wbdata_bypass_gate
                    type: BOOL
                    defaults: false
                tasks: []
                """;

        assertThat(FlowParameterMetadata.declaresInput(source, "wbdata_planned_time")).isTrue();
        assertThat(FlowParameterMetadata.declaresInput(source, "wbdata_bypass_gate")).isTrue();
        assertThat(FlowParameterMetadata.declaresInput(source, "other")).isFalse();
    }

    @Test
    void declaresInput_falseWhenNoInputsSection() {
        String source = """
                id: daily
                namespace: g4-main
                tasks: []
                """;

        assertThat(FlowParameterMetadata.declaresInput(source, "wbdata_planned_time")).isFalse();
    }

    @Test
    void declaresInput_falseForBlankArguments() {
        assertThat(FlowParameterMetadata.declaresInput(null, "wbdata_planned_time")).isFalse();
        assertThat(FlowParameterMetadata.declaresInput("", "wbdata_planned_time")).isFalse();
        assertThat(FlowParameterMetadata.declaresInput("id: x", null)).isFalse();
        assertThat(FlowParameterMetadata.declaresInput("id: x", " ")).isFalse();
    }
}
