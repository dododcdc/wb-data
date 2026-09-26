package com.wbdata.sql;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SqlParameterTemplateTest {

    @Test
    void compilesTemplateParametersInAppearanceOrder() {
        SqlParameterTemplate.Compilation result = SqlParameterTemplate.compile(
                "select * from users where name = ^[name] and day = ^[v_day] or owner = ^[name]"
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
                where name = ^[name]
                  and body = $$ dollar :ignored $$
                  and tagged = $tag$ :also_ignored $tag$
                -- :line_comment ^[commented]
                # :mysql_comment
                /* outer :block_comment /* nested :nested */ still ignored */
                """;

        SqlParameterTemplate.Compilation result = SqlParameterTemplate.compile(sql);

        assertThat(result.jdbcSql()).isEqualTo(sql.replace("^[name]", "?"));
        assertThat(result.parameterNames()).containsExactly("name");
    }

    @Test
    void rejectsTemplateParametersInAllQuotedContexts() {
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select '^[v_day]'"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select \"^[v_day]\""))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select `^[v_day]`"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select $$ ^[v_day] $$"))
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
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ^[_private]"))
                .hasMessageContaining("英文字母");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ^[1value]"))
                .hasMessageContaining("英文字母");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ^[name中文]"))
                .hasMessageContaining("^[name] 格式");
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select ^[" + "a".repeat(65) + "]"))
                .hasMessageContaining("64");
    }

    @Test
    void rendersInAppearanceOrderWithoutReplacingQuestionMarkOperators() {
        String sql = "select body ? ^[key], body ?| array[^[key]], body ?& array[^[other]], '?'";
        List<String> names = new ArrayList<>();
        Map<String, String> values = Map.of("key", "中文'\\", "other", "");

        String rendered = SqlParameterTemplate.render(sql, name -> {
            names.add(name);
            return SqlStringLiteral.render("POSTGRESQL", values.get(name));
        });

        String key = "convert_from(decode('e4b8ade69687275c', 'hex'), 'UTF8')";
        String other = "convert_from(decode('', 'hex'), 'UTF8')";
        assertThat(rendered).isEqualTo("select body ? " + key + ", body ?| array[" + key
                + "], body ?& array[" + other + "], '?'");
        assertThat(names).containsExactly("key", "key", "other");
        assertThat(SqlParameterTemplate.compile(sql).jdbcSql())
                .isEqualTo("select body ? ?, body ?| array[?], body ?& array[?], '?'");
    }

    @Test
    void renderPreservesQuotedTextAndIgnoresEvenMalformedTemplatesInComments() {
        String sql = """
                select 'it''s ?', 'back\\\\slash', "quoted?", `mysql?`, $$ ? $$, $tag$ ? $tag$
                from users where name = ^[name] and created_at::date = :day
                -- ^[ignored] '${malformed
                # ^[_invalid] "^[ignored]"
                /* ^[ignored] /* ^[1invalid] */ ^[unterminated */
                """;
        List<String> names = new ArrayList<>();

        String rendered = SqlParameterTemplate.render(sql, name -> {
            names.add(name);
            return "unhex('61')";
        });

        assertThat(rendered).isEqualTo(sql.replace("^[name]", "unhex('61')"));
        assertThat(names).containsExactly("name");
        assertThat(SqlParameterTemplate.compile(sql).parameterNames()).containsExactly("name");
    }

    @Test
    void doesNotScanTheRenderedExpressionAgain() {
        assertThat(SqlParameterTemplate.render("select ^[value]", name -> "'^[other] ?'"))
                .isEqualTo("select '^[other] ?'");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "select '^[value]'", "select \"^[value]\"", "select `^[value]`",
            "select $$ ^[value] $$", "select $tag$ ^[value] $tag$",
            "select 'it''s ^[value]'", "select 'it\\'s ^[value]'"
    })
    void renderAndCompileRejectAllQuotedTemplates(String sql) {
        assertThatThrownBy(() -> SqlParameterTemplate.render(sql, name -> "'value'"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> SqlParameterTemplate.compile(sql))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("不能位于引号内");
    }

    @ParameterizedTest
    @ValueSource(strings = {"^[]", "^[", "^[_private]", "^[1value]", "^[name中文]",
            "^[name", "^[name.value]", "^[name value]", "^[name:-default]"})
    void renderAndCompileRejectMalformedTemplates(String template) {
        assertThatThrownBy(() -> SqlParameterTemplate.render("select " + template, name -> "'value'"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SqlParameterTemplate.compile("select " + template))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void renderEnforcesNameLengthAndAllowsTheMaximum() {
        String maximumName = "a".repeat(64);
        List<String> names = new ArrayList<>();
        assertThat(SqlParameterTemplate.render("select ^[" + maximumName + "]", name -> {
            names.add(name);
            return "'value'";
        })).isEqualTo("select 'value'");
        assertThat(names).containsExactly(maximumName);
        assertThatThrownBy(() -> SqlParameterTemplate.render("select ^[" + maximumName + "a]", name -> "'value'"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("64");
    }

    @ParameterizedTest
    @NullAndEmptySource
    void preservesEmptySqlBehavior(String sql) {
        assertThat(SqlParameterTemplate.compile(sql).jdbcSql()).isEmpty();
        assertThat(SqlParameterTemplate.compile(sql).parameterNames()).isEmpty();
        assertThat(SqlParameterTemplate.render(sql, name -> {
            throw new AssertionError("Empty SQL must not render a parameter");
        })).isEmpty();
    }

    @Test
    void rejectsNullRendererAndNullRenderedValues() {
        assertThatThrownBy(() -> SqlParameterTemplate.render("select ^[value]", null))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> SqlParameterTemplate.render("select ^[value]", name -> null))
                .isInstanceOf(NullPointerException.class);
    }
}
