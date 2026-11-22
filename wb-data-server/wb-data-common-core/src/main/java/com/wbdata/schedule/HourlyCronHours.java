package com.wbdata.schedule;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 标准小时调度（HOURLY）Cron 小时字段解析与依赖覆盖校验（纯 JDK 实现）。
 * <p>
 * 支持连续全天（{@code *}）、连续步长（{@code *&#47;2}）、连续起止区间/步长（{@code 8-22}、{@code 8-22/2}）
 * 以及离散/组合小时列表（{@code 1,3,14}）。仅当有效执行小时数不少于 2 个时识别为小时调度，
 * 避免与单小时的每天调度（DAILY）产生语义冲突。
 */
public final class HourlyCronHours {

    private static final int MIN_HOUR = 0;
    private static final int MAX_HOUR = 23;
    private static final int MAX_FORMAT_ITEMS = 6;
    private static final Pattern FIXED_NUMBER = Pattern.compile("^\\d{1,2}$");
    private static final Pattern STEP_ALL = Pattern.compile("^\\*/(\\d{1,2})$");
    private static final Pattern RANGE_OR_STEP = Pattern.compile("^(\\d{1,2})-(\\d{1,2})(?:/(\\d{1,2}))?$");

    private HourlyCronHours() {
    }

    /** 解析标准 5 段小时调度 Cron，返回按升序排列的不可变执行小时集合；非法或不足 2 个小时返回 empty。 */
    public static Optional<Set<Integer>> parseHourlyCronHours(String cron) {
        if (cron == null || cron.isBlank()) {
            return Optional.empty();
        }
        String[] parts = cron.trim().split("\\s+");
        if (parts.length != 5) {
            return Optional.empty();
        }
        Integer minute = parseFixedInt(parts[0], 0, 59);
        if (minute == null || !"*".equals(parts[2]) || !"*".equals(parts[3]) || !"*".equals(parts[4])) {
            return Optional.empty();
        }
        return parseHourField(parts[1]);
    }

    /** 解析 Cron 第 2 段（小时字段）；结果至少包含 2 个有效小时（0..23）时返回有序不可变集合。 */
    public static Optional<Set<Integer>> parseHourField(String hourField) {
        if (hourField == null || hourField.isBlank()) {
            return Optional.empty();
        }
        String trimmed = hourField.trim();
        TreeSet<Integer> hours = new TreeSet<>();
        if ("*".equals(trimmed)) {
            for (int hour = MIN_HOUR; hour <= MAX_HOUR; hour++) {
                hours.add(hour);
            }
            return Optional.of(Collections.unmodifiableSortedSet(hours));
        }

        Matcher stepAll = STEP_ALL.matcher(trimmed);
        if (stepAll.matches()) {
            Integer step = parseFixedInt(stepAll.group(1), 1, MAX_HOUR);
            if (step == null) {
                return Optional.empty();
            }
            for (int hour = MIN_HOUR; hour <= MAX_HOUR; hour += step) {
                hours.add(hour);
            }
            return atLeastTwoHours(hours);
        }

        if (trimmed.contains(",")) {
            String[] tokens = trimmed.split(",", -1);
            for (String rawToken : tokens) {
                if (rawToken == null || rawToken.isBlank()) {
                    return Optional.empty();
                }
                String token = rawToken.trim();
                Integer single = parseFixedInt(token, MIN_HOUR, MAX_HOUR);
                if (single != null) {
                    hours.add(single);
                    continue;
                }
                if (!addRangeHours(token, hours)) {
                    return Optional.empty();
                }
            }
            return atLeastTwoHours(hours);
        }

        if (addRangeHours(trimmed, hours)) {
            return atLeastTwoHours(hours);
        }
        return Optional.empty();
    }

    public static boolean isHourlyCron(String cron) {
        return parseHourlyCronHours(cron).isPresent();
    }

    /** 计算 downstreamHours - upstreamHours（升序）；任一 Cron 无法按标准小时调度解析时返回 empty。 */
    public static Optional<List<Integer>> missingHours(String downstreamCron, String upstreamCron) {
        Optional<Set<Integer>> downstreamHours = parseHourlyCronHours(downstreamCron);
        Optional<Set<Integer>> upstreamHours = parseHourlyCronHours(upstreamCron);
        if (downstreamHours.isEmpty() || upstreamHours.isEmpty()) {
            return Optional.empty();
        }
        List<Integer> missing = new ArrayList<>();
        for (Integer hour : downstreamHours.get()) {
            if (!upstreamHours.get().contains(hour)) {
                missing.add(hour);
            }
        }
        return Optional.of(List.copyOf(missing));
    }

    /** 格式化小时集合用于错误提示；如 [1, 3, 14] -> "01、03、14 时"，超过 6 个截断。 */
    public static String formatHours(Collection<Integer> hours) {
        if (hours == null || hours.isEmpty()) {
            return "";
        }
        List<Integer> sorted = hours.stream()
                .distinct()
                .sorted()
                .toList();
        List<String> head = sorted.stream()
                .limit(MAX_FORMAT_ITEMS)
                .map(hour -> String.format("%02d", hour))
                .toList();
        String joined = String.join("、", head);
        if (sorted.size() > MAX_FORMAT_ITEMS) {
            return joined + " 等 " + sorted.size() + " 个小时";
        }
        return joined + " 时";
    }

    private static Optional<Set<Integer>> atLeastTwoHours(TreeSet<Integer> hours) {
        if (hours.size() < 2) {
            return Optional.empty();
        }
        return Optional.of(Collections.unmodifiableSortedSet(hours));
    }

    private static boolean addRangeHours(String expr, TreeSet<Integer> target) {
        Matcher matcher = RANGE_OR_STEP.matcher(expr);
        if (!matcher.matches()) {
            return false;
        }
        Integer start = parseFixedInt(matcher.group(1), MIN_HOUR, MAX_HOUR);
        Integer end = parseFixedInt(matcher.group(2), MIN_HOUR, MAX_HOUR);
        Integer step = matcher.group(3) == null ? 1 : parseFixedInt(matcher.group(3), 1, MAX_HOUR);
        if (start == null || end == null || step == null || start >= end) {
            return false;
        }
        for (int hour = start; hour <= end; hour += step) {
            target.add(hour);
        }
        return true;
    }

    private static Integer parseFixedInt(String raw, int min, int max) {
        if (raw == null || !FIXED_NUMBER.matcher(raw).matches()) {
            return null;
        }
        int parsed = Integer.parseInt(raw);
        if (parsed < min || parsed > max) {
            return null;
        }
        return parsed;
    }
}
