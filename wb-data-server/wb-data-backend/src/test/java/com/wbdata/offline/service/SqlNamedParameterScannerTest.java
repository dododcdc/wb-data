package com.wbdata.offline.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SqlNamedParameterScannerTest {
    private final SqlNamedParameterScanner scanner = new SqlNamedParameterScanner();

    @Test
    void findsTemplateParametersInFirstAppearanceOrderWithoutDuplicates() {
        assertThat(scanner.scan("select * from users where name = ${name} "
                + "and day = ${v_day} or owner = ${name}").parameters())
                .containsExactly("name", "v_day");
    }

    @Test
    void allowsColonTextCommentsAndPostgresqlCasts() {
        String sql = """
                select 'a:tom,b:jack', "quoted:identifier", `mysql:identifier`, created_at::date
                from users
                where name = ${name}
                  and body = $$ dollar :ignored $$
                  and tagged = $tag$ :also_ignored $tag$
                -- :line_comment ${commented}
                # :mysql_comment
                /* outer :block_comment /* nested :nested */ still ignored */
                  and day = ${v_day}
                """;

        assertThat(scanner.scan(sql).parameters()).containsExactly("name", "v_day");
    }

    @Test
    void rejectsQuotedTemplateParameters() {
        assertThatThrownBy(() -> scanner.scan("select '${v_day}'"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> scanner.scan("select \"${v_day}\""))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> scanner.scan("select `${v_day}`"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
    }

    @Test
    void passesLegacyColonSyntaxThroughAsLiteralText() {
        assertThat(scanner.scan("select :v_day, created_at::date from users").parameters())
                .isEmpty();
    }

    @Test
    void rejectsMalformedTemplateParameters() {
        assertThatThrownBy(() -> scanner.scan("select ${_private}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("英文字母");
        assertThatThrownBy(() -> scanner.scan("select ${1value}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("英文字母");
        assertThatThrownBy(() -> scanner.scan("select ${" + "a".repeat(65) + "}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("64");
    }
}
