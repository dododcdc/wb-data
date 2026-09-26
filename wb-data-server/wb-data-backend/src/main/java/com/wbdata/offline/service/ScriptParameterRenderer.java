package com.wbdata.offline.service;

import com.wbdata.sql.SqlStringLiteral;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * Renders {@code ^[name]} in HiveSQL and Shell at execution time.
 * Hive values become string literals; Hive database and table positions become identifiers.
 * Shell replaces only names present in the parameter map, using single quotes.
 */
public final class ScriptParameterRenderer {
    private static final Set<String> IDENTIFIER_KEYWORDS = Set.of(
            "FROM", "JOIN", "TABLE", "USE", "DATABASE", "INTO", "UPDATE", "DESCRIBE", "DESC");
    private static final Pattern HIVE_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    private ScriptParameterRenderer() {
    }

    public static Set<String> hiveReferences(String sql, Set<String> definedNames) {
        Set<String> names = new LinkedHashSet<>();
        walkHive(sql, definedNames, placeholder -> {
            names.add(placeholder.name());
            return "";
        });
        return names;
    }

    public static String renderHive(String sql, java.util.Map<String, String> parameters) {
        java.util.Map<String, String> values = parameters == null ? java.util.Map.of() : parameters;
        return walkHive(sql, values.keySet(), placeholder -> {
            String value = values.get(placeholder.name());
            if (value == null) {
                throw new IllegalArgumentException("HiveSQL 引用了未提供的参数: " + placeholder.name());
            }
            if (placeholder.identifier()) {
                return quoteHiveIdentifier(placeholder.name(), value);
            }
            return SqlStringLiteral.render("HIVE", value);
        });
    }

    public static Set<String> shellReferences(String script, Set<String> definedNames) {
        Set<String> names = new LinkedHashSet<>();
        if (script == null || script.isEmpty() || definedNames == null || definedNames.isEmpty()) {
            return names;
        }
        int start = 0;
        int opening;
        while ((opening = script.indexOf("^[", start)) >= 0) {
            int closing = script.indexOf(']', opening + 2);
            if (closing < 0) {
                break;
            }
            String name = script.substring(opening + 2, closing);
            if (isParameterName(name) && definedNames.contains(name)) {
                names.add(name);
            }
            start = opening + 2;
        }
        return names;
    }

    public static String renderShell(String script, java.util.Map<String, String> parameters) {
        if (script == null || script.isEmpty()) {
            return "";
        }
        java.util.Map<String, String> values = parameters == null ? java.util.Map.of() : parameters;
        StringBuilder result = new StringBuilder(script.length());
        int start = 0;
        int opening;
        while ((opening = script.indexOf("^[", start)) >= 0) {
            result.append(script, start, opening);
            int closing = script.indexOf(']', opening + 2);
            if (closing < 0) {
                result.append(script.substring(opening));
                return result.toString();
            }
            String name = script.substring(opening + 2, closing);
            if (isParameterName(name) && values.containsKey(name)) {
                String value = values.get(name);
                if (value == null) {
                    throw new IllegalArgumentException("Shell 引用了未提供的参数: " + name);
                }
                result.append(shellQuote(value));
                start = closing + 1;
            } else {
                result.append("^[");
                start = opening + 2;
            }
        }
        return result.append(script, start, script.length()).toString();
    }

    private static String walkHive(String sql,
                                   Set<String> definedNames,
                                   Function<HivePlaceholder, String> replace) {
        if (sql == null || sql.isEmpty()) {
            return "";
        }
        Set<String> defined = definedNames == null ? Set.of() : definedNames;
        StringBuilder rendered = new StringBuilder(sql.length());
        int index = 0;
        while (index < sql.length()) {
            char current = sql.charAt(index);
            if (current == '\'' || current == '"' || current == '`') {
                int end = skipQuoted(sql, index, current);
                rejectDefinedPlaceholderInQuotes(sql, index, end, defined);
                rendered.append(sql, index, end);
                index = end;
            } else if (current == '-' && hasNext(sql, index, '-')) {
                int end = skipLineComment(sql, index + 2);
                rendered.append(sql, index, end);
                index = end;
            } else if (current == '#') {
                int end = skipLineComment(sql, index + 1);
                rendered.append(sql, index, end);
                index = end;
            } else if (current == '/' && hasNext(sql, index, '*')) {
                int end = skipBlockComment(sql, index + 2);
                rendered.append(sql, index, end);
                index = end;
            } else if (current == '^' && hasNext(sql, index, '[')) {
                int nameStart = index + 2;
                if (nameStart >= sql.length() || !isAsciiLetter(sql.charAt(nameStart))) {
                    throw syntax("参数引用必须以英文字母开头", index);
                }
                int nameEnd = readNameEnd(sql, nameStart);
                if (nameEnd >= sql.length() || sql.charAt(nameEnd) != ']') {
                    throw syntax("参数引用必须使用 ^[name] 格式", index);
                }
                String name = validateName(sql, nameStart, nameEnd);
                boolean identifier = isIdentifierPosition(sql, index, nameEnd + 1);
                rendered.append(replace.apply(new HivePlaceholder(name, identifier)));
                index = nameEnd + 1;
            } else {
                rendered.append(current);
                index++;
            }
        }
        return rendered.toString();
    }

    private static boolean isIdentifierPosition(String sql, int marker, int afterClose) {
        int forward = skipWhitespaceForward(sql, afterClose);
        if (forward < sql.length() && sql.charAt(forward) == '.') {
            return true;
        }
        int backward = skipTriviaBackward(sql, marker - 1);
        if (backward >= 0 && sql.charAt(backward) == '.') {
            return true;
        }
        String word = readWordBackward(sql, backward);
        return IDENTIFIER_KEYWORDS.contains(word.toUpperCase(java.util.Locale.ROOT));
    }

    private static String quoteHiveIdentifier(String name, String value) {
        if (!HIVE_IDENTIFIER.matcher(value).matches()) {
            throw new IllegalArgumentException("库名或表名参数“" + name + "”只能包含英文字母、数字和下划线");
        }
        return "`" + value + "`";
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private static boolean isParameterName(String name) {
        if (name.isEmpty() || name.length() > 64 || !isAsciiLetter(name.charAt(0))) {
            return false;
        }
        for (int index = 1; index < name.length(); index++) {
            if (!isParameterPart(name.charAt(index))) {
                return false;
            }
        }
        return true;
    }

    private static void rejectDefinedPlaceholderInQuotes(String sql, int start, int end, Set<String> definedNames) {
        int search = start;
        while (search < end) {
            int found = sql.indexOf("^[", search);
            if (found < 0 || found >= end) {
                return;
            }
            int nameStart = found + 2;
            if (nameStart < end && isAsciiLetter(sql.charAt(nameStart))) {
                int nameEnd = nameStart + 1;
                while (nameEnd < end && isParameterPart(sql.charAt(nameEnd))) {
                    nameEnd++;
                }
                if (nameEnd < end && sql.charAt(nameEnd) == ']' && nameEnd - nameStart <= 64
                        && definedNames.contains(sql.substring(nameStart, nameEnd))) {
                    throw syntax("参数占位符不能位于引号内，请移除占位符两侧的引号", found);
                }
            }
            search = found + 2;
        }
    }

    private static int skipWhitespaceForward(String sql, int index) {
        int cursor = index;
        while (cursor < sql.length() && isSqlWhitespace(sql.charAt(cursor))) {
            cursor++;
        }
        return cursor;
    }

    private static int skipTriviaBackward(String sql, int index) {
        int cursor = index;
        while (cursor >= 0) {
            char current = sql.charAt(cursor);
            if (isSqlWhitespace(current)) {
                cursor--;
                continue;
            }
            if (current == '/' && cursor > 0 && sql.charAt(cursor - 1) == '*') {
                int open = sql.lastIndexOf("/*", cursor - 1);
                if (open < 0) {
                    break;
                }
                cursor = open - 1;
                continue;
            }
            int lineStart = sql.lastIndexOf('\n', cursor) + 1;
            int commentAt = lineCommentStart(sql, lineStart, cursor);
            if (commentAt >= 0) {
                cursor = commentAt - 1;
                continue;
            }
            break;
        }
        return cursor;
    }

    private static int lineCommentStart(String sql, int lineStart, int index) {
        boolean quoted = false;
        char quote = 0;
        for (int cursor = lineStart; cursor <= index; cursor++) {
            char current = sql.charAt(cursor);
            if (quoted) {
                if (current == '\\' && cursor + 1 <= index) {
                    cursor++;
                } else if (current == quote) {
                    if (cursor + 1 <= index && sql.charAt(cursor + 1) == quote) {
                        cursor++;
                    } else {
                        quoted = false;
                    }
                }
                continue;
            }
            if (current == '\'' || current == '"' || current == '`') {
                quoted = true;
                quote = current;
            } else if (current == '-' && cursor + 1 <= index && sql.charAt(cursor + 1) == '-') {
                return cursor;
            }
        }
        return -1;
    }

    private static String readWordBackward(String sql, int index) {
        if (index < 0 || !isParameterPart(sql.charAt(index))) {
            return "";
        }
        int start = index;
        while (start > 0 && isParameterPart(sql.charAt(start - 1))) {
            start--;
        }
        return sql.substring(start, index + 1);
    }

    private static String validateName(String sql, int start, int end) {
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

    private static boolean hasNext(String sql, int index, char expected) {
        return index + 1 < sql.length() && sql.charAt(index + 1) == expected;
    }

    private static boolean isParameterPart(char value) {
        return isAsciiLetter(value) || value >= '0' && value <= '9' || value == '_';
    }

    private static boolean isAsciiLetter(char value) {
        return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z';
    }

    private static boolean isSqlWhitespace(char value) {
        return value == ' ' || value == '\t' || value == '\n' || value == '\r' || value == '\f';
    }

    private static IllegalArgumentException syntax(String message, int position) {
        return new IllegalArgumentException(message + "，位置: " + position);
    }

    private record HivePlaceholder(String name, boolean identifier) {
    }
}
