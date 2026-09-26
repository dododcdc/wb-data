package com.wbdata.offline.transfer.service;

import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class TransferParametersTest {

    @Test
    void collectsDistinctReferencesAndIgnoresSqlCommentsAndUnusedMappingProperties() {
        TransferConfig config = config();
        assertThat(TransferParameters.references(config))
                .containsExactly("filter", "fixed", "expression", "pre", "post");
        TransferConfig hive = new TransferConfig(config.source(),
                new TransferEndpointConfig(2L, "HIVE", "warehouse", "orders", null,
                        TransferWriteMode.OVERWRITE_PARTITION, null, null),
                List.of(), List.of(
                        new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE, null, null, "day-^[partition]"),
                        new TransferPartitionMapping("region", TransferMappingKind.SOURCE_EXPRESSION, null, "^[region]", null)));
        assertThat(TransferParameters.references(hive)).containsExactly("filter", "partition", "region");
    }

    @Test
    void replacesOriginalTextOccurrencesOnceWithoutExpandingReplacementValues() {
        String value = "O'Reilly\n$(touch injected) ^[next] 中文 \\\"";
        Map<String, String> parameters = Map.of("value", value, "next", "must-not-expand");
        assertThat(TransferParameters.renderText("prefix-^[value]-^[value]-suffix", parameters))
                .isEqualTo("prefix-" + value + "-" + value + "-suffix");
        assertThat(TransferParameters.renderText("'^[value]'", parameters)).isEqualTo("'" + value + "'");
        assertThat(TransferParameters.renderText("literal :text ?", Map.of())).isEqualTo("literal :text ?");
        assertThat(TransferParameters.renderText(null, Map.of())).isNull();
        assertThat(TransferParameters.renderText("^[empty]", Map.of("empty", ""))).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"^[missing]", "prefix-^[missing]-suffix"})
    void rejectsMissingTextValues(String text) {
        assertThatIllegalArgumentException().isThrownBy(() -> TransferParameters.renderText(text, Map.of()))
                .withMessageContaining("未提供的参数: missing");
    }

    @ParameterizedTest
    @ValueSource(strings = {"^[", "^[]", "^[bad-name]", "^[nested^[name]]"})
    void rejectsMalformedFixedTextReferences(String text) {
        assertThatIllegalArgumentException().isThrownBy(() -> TransferParameters.renderText(text, Map.of()));
    }

    @Test
    void requiresAllNodeValuesIncludingPostSqlAndTreatsNullAsMissingButAllowsEmptyValues() {
        Map<String, String> parameters = new HashMap<>(Map.of(
                "filter", "", "fixed", "^[not_recursive]", "expression", "x", "pre", "x"));
        assertThatIllegalArgumentException().isThrownBy(() -> TransferParameters.requireValues(config(), parameters))
                .withMessageContaining("未提供的参数: post");
        parameters.put("post", null);
        assertThatIllegalArgumentException().isThrownBy(() -> TransferParameters.requireValues(config(), parameters))
                .withMessageContaining("未提供的参数: post");
        parameters.put("post", "");
        assertThatCode(() -> TransferParameters.requireValues(config(), parameters)).doesNotThrowAnyException();
    }

    private TransferConfig config() {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders",
                        "id = ^[filter] /* ^[ignored_where] */", null, null, null),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "orders", null, TransferWriteMode.APPEND,
                        List.of("select ^[pre] -- ^[ignored_pre]\n"), List.of("select ^[post], ^[filter]")),
                List.of(
                        new TransferFieldMapping("label", TransferMappingKind.STATIC_VALUE, null, "^[unused]", "^[fixed]-^[fixed]"),
                        new TransferFieldMapping("amount", TransferMappingKind.SOURCE_EXPRESSION, null,
                                "coalesce(^[expression], id) /* ^[ignored_expression] */"),
                        new TransferFieldMapping("id", TransferMappingKind.SOURCE_FIELD, "id", "^[unused]")),
                List.of());
    }
}
