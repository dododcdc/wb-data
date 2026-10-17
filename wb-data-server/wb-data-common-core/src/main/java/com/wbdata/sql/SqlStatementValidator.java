package com.wbdata.sql;

// 词法边界按 PostgreSQL standard_conforming_strings=on、MySQL 默认转义规则处理。
public final class SqlStatementValidator {

    private SqlStatementValidator() {
    }

    public static boolean isSingleStatement(String sql, String dataSourceType) {
        boolean mysql = "MYSQL".equalsIgnoreCase(dataSourceType);
        boolean postgres = "POSTGRESQL".equalsIgnoreCase(dataSourceType);
        boolean clickhouse = "CLICKHOUSE".equalsIgnoreCase(dataSourceType);
        if (sql == null || (!mysql && !postgres && !clickhouse)) {
            return false;
        }

        boolean hasToken = false;
        boolean terminated = false;
        int i = 0;
        while (i < sql.length()) {
            char c = sql.charAt(i);
            if (Character.isWhitespace(c)) {
                i++;
                continue;
            }
            if ((mysql && c == '#') || (sql.startsWith("--", i)
                    && (!mysql || i + 2 == sql.length() || isMysqlCommentSpace(sql.charAt(i + 2))))) {
                while (i < sql.length() && sql.charAt(i) != '\n' && sql.charAt(i) != '\r') {
                    i++;
                }
                continue;
            }
            if (sql.startsWith("/*", i)) {
                // 可执行注释可能夹带任意语句，不能当作普通注释忽略。
                if (mysql && (sql.startsWith("/*!", i) || sql.regionMatches(true, i, "/*M!", 0, 4))) {
                    return false;
                }
                i = skipBlockComment(sql, i + 2, postgres);
                if (i < 0) {
                    return false;
                }
                continue;
            }
            if (terminated) {
                return false;
            }
            if (c == ';') {
                if (!hasToken) {
                    return false;
                }
                terminated = true;
                i++;
                continue;
            }
            // DELIMITER 是客户端脚本指令，不是数据库单语句。
            if (!hasToken && sql.regionMatches(true, i, "DELIMITER", 0, 9)
                    && (i + 9 == sql.length() || !isIdentifierPart(sql.charAt(i + 9)))) {
                return false;
            }
            hasToken = true;
            if (c == '\'' || c == '"' || (c == '`' && !postgres)) {
                boolean backslashEscape = clickhouse || (mysql && c != '`')
                        || (postgres && c == '\'' && isPostgresEscapeString(sql, i));
                i = skipQuoted(sql, i, c, backslashEscape);
                if (i < 0) {
                    return false;
                }
            } else if (postgres && c == '$' && (i == 0 || !isIdentifierPart(sql.charAt(i - 1)))) {
                String delimiter = dollarDelimiter(sql, i);
                if (delimiter == null) {
                    i++;
                } else {
                    int end = sql.indexOf(delimiter, i + delimiter.length());
                    if (end < 0) {
                        return false;
                    }
                    i = end + delimiter.length();
                }
            } else if (isIdentifierStart(c)) {
                do {
                    i++;
                } while (i < sql.length() && isIdentifierPart(sql.charAt(i)));
            } else {
                i++;
            }
        }
        return hasToken;
    }

    private static int skipQuoted(String sql, int start, char quote, boolean backslashEscape) {
        int i = start + 1;
        while (i < sql.length()) {
            char c = sql.charAt(i++);
            if (c == '\\' && backslashEscape) {
                i++;
            } else if (c == quote) {
                if (i < sql.length() && sql.charAt(i) == quote) {
                    i++;
                } else {
                    return i;
                }
            }
        }
        return -1;
    }

    private static int skipBlockComment(String sql, int start, boolean nested) {
        int depth = 1;
        int i = start;
        while (i < sql.length()) {
            if (sql.startsWith("*/", i)) {
                i += 2;
                if (--depth == 0) {
                    return i;
                }
            } else if (nested && sql.startsWith("/*", i)) {
                depth++;
                i += 2;
            } else {
                i++;
            }
        }
        return -1;
    }

    private static boolean isPostgresEscapeString(String sql, int quote) {
        return quote > 0 && (sql.charAt(quote - 1) == 'E' || sql.charAt(quote - 1) == 'e')
                && (quote == 1 || !isIdentifierPart(sql.charAt(quote - 2)));
    }

    private static String dollarDelimiter(String sql, int start) {
        int i = start + 1;
        if (i < sql.length() && isIdentifierStart(sql.charAt(i))) {
            do {
                i++;
            } while (i < sql.length() && (isIdentifierStart(sql.charAt(i)) || Character.isDigit(sql.charAt(i))));
        }
        return i < sql.length() && sql.charAt(i) == '$' ? sql.substring(start, i + 1) : null;
    }

    private static boolean isMysqlCommentSpace(char c) {
        return c <= ' ' || c == '\u007f';
    }

    private static boolean isIdentifierStart(char c) {
        return c == '_' || Character.isLetter(c) || c >= '\u0080';
    }

    private static boolean isIdentifierPart(char c) {
        return isIdentifierStart(c) || Character.isDigit(c) || c == '$';
    }
}
