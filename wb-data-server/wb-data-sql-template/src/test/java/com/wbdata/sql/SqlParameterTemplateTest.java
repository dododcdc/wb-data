package com.wbdata.sql;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SqlParameterTemplateTest {

    @Test
    void compilesTemplateParametersInAppearanceOrder() {
        SqlParameterTemplate.Compilation result = SqlParameterTemplate.compile(
                "select * from users where name = ${name} and day = ${v_day} or owner = ${name}"
        );

        assertThat(result.jdbcSql())
                .isEqualTo("select * from users where name = ? and day = ? or owner = ?");
        assertThat(result.parameterNames()).containsExactly("name", "v_day", "name");
    }

    @Test
    void leavesColonTextCommentsAndPostgresqlCastsUntouched() {
        String sql = """
                select 'a:tom,b:jack', "quoted:identifier", `mysql:identifier`, created_at::date
                from users
                where name = ${name}
                  and body = $$ dollar :ignored $$
                  and tagged = $tag$ :also_ignored $tag$
                -- :line_comment ${commented}
                # :mysql_comment
                /* outer :block_comment /* nested :nested */ still ignored */
                """;

        SqlParameterTemplate.Compilation result = SqlParameterTemplate.compile(sql);

        assertThat(result.jdbcSql()).isEqualTo(sql.replace("${name}", "?"));
        assertThat(result.parameterNames()).containsExactly("name");
    }

    @Test
    void rejectsTemplateParametersInAllQuotedContexts() {
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select '${v_day}'"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select \"${v_day}\""))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select `${v_day}`"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select $$ ${v_day} $$"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
    }

    @Test
    void passesColonSyntaxThroughAsLiteralText() {
        String sql = "select ':literal', created_at::date where name=:name";

        SqlParameterTemplate.Compilation result = SqlParameterTemplate.compile(sql);

        assertThat(result.jdbcSql()).isEqualTo(sql);
        assertThat(result.parameterNames()).isEmpty();
    }

    @Test
    void rejectsMalformedParameterNames() {
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ${_private}"))
                .hasMessageContaining("英文字母");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ${1value}"))
                .hasMessageContaining("英文字母");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ${name中文}"))
                .hasMessageContaining("${name} 格式");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ${" + "a".repeat(65) + "}"))
                .hasMessageContaining("64");
    }
}
