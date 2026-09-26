package com.wbdata.offline.service;

import com.wbdata.sql.SqlStringLiteral;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScriptParameterRendererTest {

    @Test
    void rendersHiveValuesAsLiteralsAndDatabaseNamesAsIdentifiers() {
        String rendered = ScriptParameterRenderer.renderHive(
                "select ^[name] from ^[DWD].dwd_imei_info_all_d where dt = ^[v_day]",
                Map.of("name", "小明", "DWD", "dev_dwd", "v_day", "20240926"));

        assertThat(rendered).isEqualTo("select " + SqlStringLiteral.render("HIVE", "小明")
                + " from `dev_dwd`.dwd_imei_info_all_d where dt = "
                + SqlStringLiteral.render("HIVE", "20240926"));
    }

    @Test
    void rendersHiveIdentifierAfterKeywordCommentOrDot() {
        Map<String, String> parameters = Map.of("DWD", "dev_dwd", "TABLE", "orders");

        assertThat(ScriptParameterRenderer.renderHive("USE ^[DWD]", parameters)).isEqualTo("USE `dev_dwd`");
        assertThat(ScriptParameterRenderer.renderHive("from -- comment\n^[DWD]", parameters))
                .isEqualTo("from -- comment\n`dev_dwd`");
        assertThat(ScriptParameterRenderer.renderHive("^[DWD].^[TABLE]", parameters))
                .isEqualTo("`dev_dwd`.`orders`");
    }

    @Test
    void keepsHiveRegexInQuotesAndRejectsQuotedDefinedParameters() {
        assertThat(ScriptParameterRenderer.renderHive(
                "select ^[name] where name rlike '^[abc]'", Map.of("name", "小明")))
                .isEqualTo("select " + SqlStringLiteral.render("HIVE", "小明") + " where name rlike '^[abc]'");
        assertThatThrownBy(() -> ScriptParameterRenderer.renderHive("select '^[name]'", Map.of("name", "小明")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
    }

    @Test
    void rejectsUnsafeHiveIdentifiers() {
        assertThatThrownBy(() -> ScriptParameterRenderer.renderHive(
                "from ^[DWD].orders", Map.of("DWD", "dev_dwd; drop")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("库名或表名");
    }

    @Test
    void rendersShellQuotesOnlyForKnownParameters() {
        assertThat(ScriptParameterRenderer.renderShell(
                "echo ^[name]\nfile_^[v_day].csv\ngrep ^[abc]\n",
                Map.of("name", "小明", "v_day", "20240926")))
                .isEqualTo("echo '小明'\nfile_'20240926'.csv\ngrep ^[abc]\n");
        assertThat(ScriptParameterRenderer.renderShell("echo ^[name]", Map.of("name", "a'b$(rm)")))
                .isEqualTo("echo 'a'\"'\"'b$(rm)'");
    }

    @Test
    void shellReferencesIgnoreUnknownTokens() {
        assertThat(ScriptParameterRenderer.shellReferences("echo ^[name] ^[abc] ^[a-z]", Set.of("name")))
                .containsExactly("name");
        assertThat(ScriptParameterRenderer.hiveReferences(
                "select ^[name] from ^[DWD].t -- ^[missing]\n", Set.of("name", "DWD")))
                .containsExactly("name", "DWD");
    }
}
