package com.wbdata.sql;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SqlStatementValidatorTest {

    private static final List<String> TYPES = List.of("MYSQL", "POSTGRESQL", "CLICKHOUSE");

    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT 1",
            "SELECT 1;",
            "\n UPDATE target\n SET name = 'new'\n WHERE id = 1; \n",
            "INSERT INTO target (id, name) VALUES (1, 'a;b'), (2, 'c')",
            "DELETE FROM target WHERE id = 1",
            "CREATE TABLE target (id INT, name VARCHAR(20));",
            "ALTER TABLE target ADD COLUMN active INT",
            "DROP TABLE target;",
            "TRUNCATE TABLE target;",
            "SELECT 'a;''b', \"a;\"\"b\";",
            "SELECT '-- ; /* #', '/* ; */';",
            "/* ; SELECT hidden */ SELECT 1; /* ; UPDATE hidden */",
            "-- ; SELECT hidden\n SELECT 1; -- ; DROP hidden",
            "SELECT 1 -- ignored;\r\n + 2;",
            "SELECT 1; -- trailing comment without newline",
            "SELECT 1 /* 'unclosed quote in comment ; */",
            "SELECT 1; /* trailing */ -- comment\r\n"
    })
    void acceptsCommonSingleStatements(String sql) {
        for (String type : TYPES) {
            assertThat(SqlStatementValidator.isSingleStatement(sql, type)).as("%s: %s", type, sql).isTrue();
        }
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {
            " \n\t ",
            ";",
            "; SELECT 1",
            "SELECT 1;;",
            "SELECT 1; SELECT 2",
            "SELECT 1; /* comment */\n DELETE FROM target",
            "SELECT 'ok'; -- comment\n DROP TABLE target;",
            "-- only a comment",
            "/* only a comment; */",
            "/* comment */ -- comment\n",
            "/* unclosed",
            "SELECT 1; /* unclosed trailing comment",
            "SELECT 'unclosed",
            "SELECT 'ends with a doubled quote''",
            "SELECT \"unclosed",
            "SELECT 1; 'trailing text'",
            "DELIMITER $$\n CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$",
            "/* leading comment */ delimiter //"
    })
    void rejectsEmptyMalformedAndMultipleStatements(String sql) {
        for (String type : TYPES) {
            assertThat(SqlStatementValidator.isSingleStatement(sql, type)).as("%s: %s", type, sql).isFalse();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT $$a;b$$;",
            "SELECT $tag_1$a;'\"/* # -- $other$ $tag_1$;",
            "SELECT $标签$a;b$标签$;",
            "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;",
            "DO $body$ BEGIN RAISE NOTICE 'a;b'; END $body$; -- end",
            "SELECT E'a\\';b';",
            "SELECT e'a\\';b';",
            "SELECT E'a\\\\';",
            "SELECT E'a'';b';",
            "SELECT '\\';",
            "SELECT 'C:\\temp\\'; -- standard string, not backslash escaped",
            "SELECT \"identifier\\\";",
            "/* outer /* nested ; ' */ still comment */ SELECT 1;",
            "SELECT 1; /* outer /* nested */ trailing */",
            "SELECT 1--no space; DROP TABLE hidden",
            "SELECT json_value #>> '{path,to,key}' FROM target;"
    })
    void acceptsPostgresQuotingAndComments(String sql) {
        assertThat(SqlStatementValidator.isSingleStatement(sql, "POSTGRESQL")).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT $$unclosed;",
            "SELECT $tag$wrong closing$TAG$;",
            "SELECT $tag$unclosed$$",
            "SELECT $$one;$$; SELECT 2",
            "DO $$ BEGIN PERFORM 1; END $$; DROP TABLE target;",
            "SELECT E'unclosed\\'",
            "SELECT '\\'; SELECT 'second';",
            "SELECT '\\'; SELECT 2 --'",
            "SELECT \"identifier\\\"; DROP TABLE target; --\"",
            "SELECT someE'\\'; SELECT 2 --'",
            "SELECT some$tag$; SELECT 2; $tag$",
            "SELECT $1$; SELECT 2; $1$",
            "SELECT 1; # not a comment",
            "# not a comment; SELECT 2",
            "SELECT 1 # not a comment; SELECT 2",
            "SELECT 1; /* outer /* inner */",
            "/* outer /* inner */"
    })
    void rejectsPostgresBoundaryBypasses(String sql) {
        assertThat(SqlStatementValidator.isSingleStatement(sql, "POSTGRESQL")).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT `a;``b` FROM target;",
            "SELECT 'a\\';b', \"c\\\";d\";",
            "SELECT 'a\\\\';",
            "# ignored ; SELECT hidden\n SELECT 1; # ignored;",
            "SELECT 1; --\tignored ; SELECT hidden",
            "SELECT 1; --\r\n # more comments",
            "SELECT 1; --\u000bignored ;",
            "SELECT 1 -- comment\n + 2;"
    })
    void acceptsMysqlQuotingAndComments(String sql) {
        assertThat(SqlStatementValidator.isSingleStatement(sql, "MYSQL")).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "# only a comment",
            "SELECT `unclosed",
            "SELECT 'trailing backslash\\",
            "SELECT 1--not-comment; SELECT 2",
            "SELECT 1; --not-a-comment",
            "SELECT 1; --\u2003not-mysql-space; SELECT 2",
            "SELECT 1 # comment\n; SELECT 2",
            "SELECT 'a\\\\'; SELECT 2",
            "SELECT `identifier\\`; DROP TABLE target; -- `",
            "/*! SELECT 1; SELECT 2 */",
            "SELECT 1 /*!50000 ; DROP TABLE target */",
            "SELECT 1; /*!50000 DROP TABLE target */",
            "/*M!100100 SELECT 1; DROP TABLE target */",
            "SELECT 1 /*m! ; DROP TABLE target */",
            "SELECT 1 /* outer /* inner */; DROP TABLE target; -- */",
            "SELECT $$a;b$$;"
    })
    void rejectsMysqlBoundaryBypasses(String sql) {
        assertThat(SqlStatementValidator.isSingleStatement(sql, "MYSQL")).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "CREATE TABLE target (id UInt64) ENGINE = MergeTree ORDER BY id;",
            "ALTER TABLE target DELETE WHERE id = 1;",
            "INSERT INTO target VALUES (1), (2);",
            "SELECT 'a\\';b', `a\\`;b`, \"a\\\";b\";",
            "SELECT `a;``b`;",
            "SELECT 1--comment; SELECT hidden",
            "/* ; hidden */ SELECT 1; /* trailing */"
    })
    void acceptsClickhouseStatements(String sql) {
        assertThat(SqlStatementValidator.isSingleStatement(sql, "CLICKHOUSE")).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT 1; INSERT INTO target VALUES (2)",
            "SELECT `unclosed",
            "SELECT 'unclosed\\'",
            "SELECT 1; # not skipped",
            "SELECT 1 # not skipped; SELECT 2",
            "SELECT 1 /* unclosed",
            "SELECT 1 /* outer /* inner */; DROP TABLE target; -- */"
    })
    void rejectsClickhouseBoundaryBypasses(String sql) {
        assertThat(SqlStatementValidator.isSingleStatement(sql, "CLICKHOUSE")).isFalse();
    }

    @Test
    void mysqlExecutableCommentsAreOrdinaryCommentsInOtherDialects() {
        for (String type : List.of("POSTGRESQL", "CLICKHOUSE")) {
            assertThat(SqlStatementValidator.isSingleStatement("SELECT 1; /*! ; SELECT 2 */", type)).isTrue();
            assertThat(SqlStatementValidator.isSingleStatement("SELECT 1; /*M! ; SELECT 2 */", type)).isTrue();
        }
    }

    @Test
    void onlyAcceptsTheThreeSupportedTypes() {
        for (String type : List.of("HIVE", "MARIADB", "ORACLE", "", "POSTGRES", " MYSQL ")) {
            assertThat(SqlStatementValidator.isSingleStatement("SELECT 1", type)).isFalse();
        }
        assertThat(SqlStatementValidator.isSingleStatement("SELECT 1", null)).isFalse();
        assertThat(SqlStatementValidator.isSingleStatement("SELECT 1", "mysql")).isTrue();
        assertThat(SqlStatementValidator.isSingleStatement("SELECT 1", "PostgreSQL")).isTrue();
        assertThat(SqlStatementValidator.isSingleStatement("SELECT 1", "clickhouse")).isTrue();
    }
}
