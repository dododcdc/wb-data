package com.wbdata.sql;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;

/**
 * Compiles or renders WB-Data SQL value placeholders using shared lexical rules.
 */
public final class SqlParameterTemplate {

    private SqlParameterTemplate() {
    }

    public static Compilation compile(String sql) {
        List<String> parameterNames = new ArrayList<>();
        String jdbcSql = render(sql, name -> {
            parameterNames.add(name);
            return "?";
        });
        return new Compilation(jdbcSql, List.copyOf(parameterNames));
    }

    // The callback must return a safe SQL value expression, never an identifier or raw user input.
    public static String render(String sql, Function<String, String> renderParameter) {
        Objects.requireNonNull(renderParameter, "renderParameter");
        if (sql == null || sql.isEmpty()) {
            return "";
        }

        StringBuilder renderedSql = new StringBuilder(sql.length());
        int index = 0;
        while (index < sql.length()) {
            char current = sql.charAt(index);
            if (current == '\'' || current == '"' || current == '`') {
                int end = skipQuoted(sql, index, current);
                rejectTemplateInQuotedText(sql, index, end);
                renderedSql.append(sql, index, end);
                index = end;
            } else if (current == '-' && hasNext(sql, index, '-')) {
                int end = skipLineComment(sql, index + 2);
                renderedSql.append(sql, index, end);
                index = end;
            } else if (current == '#') {
                int end = skipLineComment(sql, index + 1);
                renderedSql.append(sql, index, end);
                index = end;
            } else if (current == '/' && hasNext(sql, index, '*')) {
                int end = skipBlockComment(sql, index + 2);
                renderedSql.append(sql, index, end);
                index = end;
            } else if (current == '$' && hasNext(sql, index, '{')) {
                index = readTemplateParameter(sql, index, renderedSql, renderParameter);
            } else if (current == '$') {
                int end = skipDollarQuote(sql, index);
                if (end != index) {
                    rejectTemplateInQuotedText(sql, index, end);
                    renderedSql.append(sql, index, end);
                    index = end;
                } else {
                    renderedSql.append(current);
                    index++;
                }
            } else {
                renderedSql.append(current);
                index++;
            }
        }
        return renderedSql.toString();
    }

    private static int readTemplateParameter(String sql,
                                             int dollar,
                                             StringBuilder renderedSql,
                                             Function<String, String> renderParameter) {
        int start = dollar + 2;
        if (start >= sql.length() || !isAsciiLetter(sql.charAt(start))) {
            throw syntax("参数引用必须以英文字母开头", dollar);
        }
        int end = readNameEnd(sql, start);
        if (end >= sql.length() || sql.charAt(end) != '}') {
            throw syntax("参数引用必须使用 ${name} 格式", dollar);
        }
        String name = validateName(sql, start, end, dollar);
        renderedSql.append(Objects.requireNonNull(renderParameter.apply(name), "Rendered parameter: " + name));
        return end + 1;
    }

    private static String validateName(String sql, int start, int end, int position) {
        if (end < sql.length() && Character.isLetterOrDigit(sql.charAt(end))) {
            throw syntax("参数键只能包含英文字母、数字和下划线", position);
        }
        String name = sql.substring(start, end);
        if (name.length() > 64) {
            throw new IllegalArgumentException("参数键长度不能超过 64: " + name);
        }
        return name;
    }

    private static int readNameEnd(String sql, int start) {
        int end = start + 1;
        while (end < sql.length() && isParameterPart(sql.charAt(end))) {
            end++;
        }
        return end;
    }

    private static void rejectTemplateInQuotedText(String sql, int start, int end) {
        int placeholder = sql.indexOf("${", start);
        if (placeholder >= 0 && placeholder < end) {
            throw syntax("参数占位符不能位于引号内，请移除占位符两侧的引号", placeholder);
        }
    }

    private static int skipQuoted(String sql, int opening, char quote) {
        int index = opening + 1;
        while (index < sql.length()) {
            char current = sql.charAt(index);
            if (current == '\\' && index + 1 < sql.length()) {
                index += 2;
            } else if (current == quote) {
                if (index + 1 < sql.length() && sql.charAt(index + 1) == quote) {
                    index += 2;
                } else {
                    return index + 1;
                }
            } else {
                index++;
            }
        }
        return index;
    }

    private static int skipLineComment(String sql, int start) {
        int newline = sql.indexOf('\n', start);
        return newline < 0 ? sql.length() : newline + 1;
    }

    private static int skipBlockComment(String sql, int start) {
        int depth = 1;
        int index = start;
        while (index < sql.length() && depth > 0) {
            if (sql.charAt(index) == '/' && hasNext(sql, index, '*')) {
                depth++;
                index += 2;
            } else if (sql.charAt(index) == '*' && hasNext(sql, index, '/')) {
                depth--;
                index += 2;
            } else {
                index++;
            }
        }
        return index;
    }

    private static int skipDollarQuote(String sql, int opening) {
        int tagEnd = sql.indexOf('$', opening + 1);
        if (tagEnd < 0) {
            return opening;
        }
        String tagBody = sql.substring(opening + 1, tagEnd);
        if (!tagBody.isEmpty() && !isDollarTag(tagBody)) {
            return opening;
        }
        String delimiter = sql.substring(opening, tagEnd + 1);
        int closing = sql.indexOf(delimiter, tagEnd + 1);
        return closing < 0 ? sql.length() : closing + delimiter.length();
    }

    private static boolean isDollarTag(String tag) {
        if (!(isAsciiLetter(tag.charAt(0)) || tag.charAt(0) == '_')) {
            return false;
        }
        for (int index = 1; index < tag.length(); index++) {
            if (!isParameterPart(tag.charAt(index))) {
                return false;
            }
        }
        return true;
    }

    private static boolean hasNext(String sql, int index, char expected) {
        return index + 1 < sql.length() && sql.charAt(index + 1) == expected;
    }

    private static boolean isParameterPart(char value) {
        return isAsciiLetter(value) || value >= '0' && value <= '9' || value == '_';
    }

    private static boolean isAsciiLetter(char value) {
        return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z';
    }

    private static IllegalArgumentException syntax(String message, int position) {
        return new IllegalArgumentException(message + "，位置: " + position);
    }

    public record Compilation(String jdbcSql, List<String> parameterNames) {
    }
}
