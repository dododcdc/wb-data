package com.wbdata.parameter.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.parameter.dto.CreateParameterGroupRequest;
import com.wbdata.parameter.dto.ParameterDefinitionRequest;
import com.wbdata.parameter.dto.ParameterDefinitionResponse;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import com.wbdata.parameter.dto.ParameterGroupSummaryResponse;
import com.wbdata.parameter.dto.ParameterPreviewRequest;
import com.wbdata.parameter.dto.ParameterPreviewResponse;
import com.wbdata.parameter.dto.ParameterPreviewValueResponse;
import com.wbdata.parameter.dto.UpdateParameterGroupRequest;
import com.wbdata.parameter.entity.WbParameterDefinition;
import com.wbdata.parameter.entity.WbParameterGroup;
import com.wbdata.parameter.mapper.WbParameterDefinitionMapper;
import com.wbdata.parameter.mapper.WbParameterGroupMapper;
import com.wbdata.parameter.model.ParameterTimeBasis;
import com.wbdata.parameter.model.ParameterValueSource;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ParameterGroupService {
    private static final Pattern KEY_PATTERN = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,63}");
    private static final String ACTIVE = "ACTIVE";
    private static final String ARCHIVED = "ARCHIVED";

    private final WbParameterGroupMapper groupMapper;
    private final WbParameterDefinitionMapper definitionMapper;

    public PageResult<ParameterGroupSummaryResponse> list(Long groupId, PageQuery query, String status) {
        LambdaQueryWrapper<WbParameterGroup> wrapper = new LambdaQueryWrapper<WbParameterGroup>()
                .eq(WbParameterGroup::getGroupId, groupId)
                .orderByDesc(WbParameterGroup::getUpdatedAt)
                .orderByDesc(WbParameterGroup::getId);
        if (status != null && !status.isBlank()) {
            wrapper.eq(WbParameterGroup::getStatus, parseStatus(status));
        }
        if (query.getKeyword() != null && !query.getKeyword().isBlank()) {
            String keyword = query.getKeyword().trim();
            wrapper.and(it -> it.like(WbParameterGroup::getName, keyword)
                    .or()
                    .like(WbParameterGroup::getCode, keyword));
        }

        IPage<WbParameterGroup> page = groupMapper.selectPage(query.toMyBatisPage(), wrapper);
        List<Long> ids = page.getRecords().stream().map(WbParameterGroup::getId).toList();
        Map<Long, Long> counts = ids.isEmpty()
                ? Map.of()
                : definitionMapper.selectList(new LambdaQueryWrapper<WbParameterDefinition>()
                        .in(WbParameterDefinition::getParameterGroupId, ids)).stream()
                .collect(Collectors.groupingBy(WbParameterDefinition::getParameterGroupId, Collectors.counting()));

        PageResult<WbParameterGroup> raw = PageResult.of(page);
        return raw.convert(group -> toSummary(group, counts.getOrDefault(group.getId(), 0L)));
    }

    @Transactional
    public ParameterGroupResponse create(Long groupId, Long userId, CreateParameterGroupRequest request) {
        String code = normalizeCode(request.code());
        ensureCodeAvailable(groupId, code);
        List<CanonicalDefinition> definitions = normalizeDefinitions(request.definitions());

        WbParameterGroup group = new WbParameterGroup();
        group.setGroupId(groupId);
        group.setCode(code);
        group.setName(normalizeRequired(request.name(), "参数组名称不能为空"));
        group.setDescription(blankToNull(request.description()));
        group.setVersion(1);
        group.setRevision(1);
        group.setStatus(ACTIVE);
        group.setCreatedBy(userId);
        group.setUpdatedBy(userId);
        try {
            groupMapper.insert(group);
        } catch (DuplicateKeyException ex) {
            throw conflict("参数组代码已存在: " + code);
        }

        List<WbParameterDefinition> saved = insertDefinitions(group.getId(), definitions);
        return toResponse(group, saved);
    }

    public ParameterGroupResponse get(Long groupId, Long id) {
        WbParameterGroup group = requireGroup(groupId, id);
        return toResponse(group, selectDefinitions(id));
    }

    public Optional<ParameterGroupResponse> findByCode(Long groupId, String code) {
        WbParameterGroup group = groupMapper.selectOne(new LambdaQueryWrapper<WbParameterGroup>()
                .eq(WbParameterGroup::getGroupId, groupId)
                .eq(WbParameterGroup::getCode, code));
        if (group == null) {
            return Optional.empty();
        }
        return Optional.of(toResponse(group, selectDefinitions(group.getId())));
    }

    @Transactional
    public ParameterGroupResponse update(Long groupId, Long id, Long userId, UpdateParameterGroupRequest request) {
        WbParameterGroup group = requireGroup(groupId, id);
        if (!group.getRevision().equals(request.expectedRevision())) {
            throw concurrentModification();
        }

        List<WbParameterDefinition> existing = selectDefinitions(id);
        List<CanonicalDefinition> currentDefinitions = existing.stream()
                .map(this::fromEntity)
                .sorted(canonicalOrder())
                .toList();
        List<CanonicalDefinition> requestedDefinitions = normalizeDefinitions(request.definitions());
        boolean definitionsChanged = !currentDefinitions.equals(requestedDefinitions);
        String name = normalizeRequired(request.name(), "参数组名称不能为空");
        String description = blankToNull(request.description());
        boolean metadataChanged = !Objects.equals(group.getName(), name)
                || !Objects.equals(group.getDescription(), description);
        if (!definitionsChanged && !metadataChanged) {
            return toResponse(group, existing);
        }
        int nextVersion = definitionsChanged ? group.getVersion() + 1 : group.getVersion();
        int nextRevision = group.getRevision() + 1;

        UpdateWrapper<WbParameterGroup> update = new UpdateWrapper<WbParameterGroup>()
                .eq("id", id)
                .eq("group_id", groupId)
                .eq("revision", request.expectedRevision())
                .set("name", name)
                .set("description", description)
                .set("updated_by", userId)
                .set("version", nextVersion)
                .set("revision", nextRevision);
        if (groupMapper.update(null, update) != 1) {
            throw concurrentModification();
        }

        List<WbParameterDefinition> saved = existing;
        if (definitionsChanged) {
            saved = replaceDefinitions(id, requestedDefinitions);
        }
        group.setName(name);
        group.setDescription(description);
        group.setUpdatedBy(userId);
        group.setVersion(nextVersion);
        group.setRevision(nextRevision);
        return toResponse(group, saved);
    }

    @Transactional
    public ParameterGroupResponse archive(Long groupId, Long id, Long userId) {
        return changeStatus(groupId, id, userId, ARCHIVED);
    }

    @Transactional
    public ParameterGroupResponse restore(Long groupId, Long id, Long userId) {
        return changeStatus(groupId, id, userId, ACTIVE);
    }

    public ParameterPreviewResponse preview(Long groupId, Long id, ParameterPreviewRequest request) {
        WbParameterGroup group = requireGroup(groupId, id);
        List<WbParameterDefinition> definitions = selectDefinitions(id);
        boolean requiresPlannedTime = definitions.stream().anyMatch(definition ->
                ParameterValueSource.SYSTEM_TIME.name().equals(definition.getValueSource())
                        && ParameterTimeBasis.PLANNED_TIME.name().equals(definition.getTimeBasis()));
        boolean requiresExecutionStartTime = definitions.stream().anyMatch(definition ->
                ParameterValueSource.SYSTEM_TIME.name().equals(definition.getValueSource())
                        && ParameterTimeBasis.EXECUTION_START_TIME.name().equals(definition.getTimeBasis()));
        if (requiresPlannedTime && request.plannedTime() == null) {
            throw badRequest("计划时间不能为空");
        }
        if (requiresExecutionStartTime && request.executionStartTime() == null) {
            throw badRequest("执行开始时间不能为空");
        }
        ZoneId runtimeTimezone = parseTimezone(request.runtimeTimezone());
        OffsetDateTime plannedTime = resolvePreviewTime(
                request.plannedTime(), runtimeTimezone, "计划时间");
        OffsetDateTime executionStartTime = resolvePreviewTime(
                request.executionStartTime(), runtimeTimezone, "执行开始时间");
        Map<String, String> overrides = request.overrides() == null ? Map.of() : request.overrides();

        Set<String> knownKeys = definitions.stream()
                .map(WbParameterDefinition::getParameterKey)
                .collect(Collectors.toSet());
        List<String> unknownKeys = overrides.keySet().stream().filter(key -> !knownKeys.contains(key)).toList();
        if (!unknownKeys.isEmpty()) {
            throw badRequest("覆盖参数不存在: " + String.join(", ", unknownKeys));
        }

        List<ParameterPreviewValueResponse> values = definitions.stream().map(definition -> {
            CanonicalDefinition canonical = fromEntity(definition);
            boolean overridden = overrides.containsKey(canonical.key());
            String value = overridden
                    ? parseOverride(canonical, overrides.get(canonical.key()))
                    : resolveValue(canonical, request, runtimeTimezone);
            return new ParameterPreviewValueResponse(
                    canonical.key(),
                    canonical.valueSource().name(),
                    canonical.timeBasis() == null ? null : canonical.timeBasis().name(),
                    value,
                    overridden
            );
        }).toList();

        return new ParameterPreviewResponse(
                group.getId(),
                group.getVersion(),
                runtimeTimezone.getId(),
                plannedTime,
                executionStartTime,
                values
        );
    }

    private OffsetDateTime resolvePreviewTime(LocalDateTime value,
                                              ZoneId runtimeTimezone,
                                              String fieldName) {
        if (value == null) {
            return null;
        }
        List<ZoneOffset> validOffsets = runtimeTimezone.getRules().getValidOffsets(value);
        if (validOffsets.isEmpty()) {
            throw badRequest(fieldName + "在任务运行时区中不存在，请换一个时间");
        }
        if (validOffsets.size() > 1) {
            throw badRequest(fieldName + "在任务运行时区中不唯一，请换一个时间");
        }
        return value.atOffset(validOffsets.getFirst());
    }

    private ParameterGroupResponse changeStatus(Long groupId, Long id, Long userId, String status) {
        WbParameterGroup group = requireGroup(groupId, id);
        if (!status.equals(group.getStatus())) {
            int nextRevision = group.getRevision() + 1;
            UpdateWrapper<WbParameterGroup> update = new UpdateWrapper<WbParameterGroup>()
                    .eq("id", id)
                    .eq("group_id", groupId)
                    .eq("revision", group.getRevision())
                    .set("status", status)
                    .set("updated_by", userId)
                    .set("revision", nextRevision);
            if (groupMapper.update(null, update) != 1) {
                throw concurrentModification();
            }
            group.setStatus(status);
            group.setUpdatedBy(userId);
            group.setRevision(nextRevision);
        }
        return toResponse(group, selectDefinitions(id));
    }

    private WbParameterGroup requireGroup(Long groupId, Long id) {
        WbParameterGroup group = groupMapper.selectById(id);
        if (group == null || !groupId.equals(group.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "参数组不存在");
        }
        return group;
    }

    private void ensureCodeAvailable(Long groupId, String code) {
        Long count = groupMapper.selectCount(new LambdaQueryWrapper<WbParameterGroup>()
                .eq(WbParameterGroup::getGroupId, groupId)
                .eq(WbParameterGroup::getCode, code));
        if (count != null && count > 0) {
            throw conflict("参数组代码已存在: " + code);
        }
    }

    private List<WbParameterDefinition> selectDefinitions(Long parameterGroupId) {
        return definitionMapper.selectList(new LambdaQueryWrapper<WbParameterDefinition>()
                .eq(WbParameterDefinition::getParameterGroupId, parameterGroupId)
                .orderByAsc(WbParameterDefinition::getSortOrder)
                .orderByAsc(WbParameterDefinition::getId));
    }

    private List<WbParameterDefinition> replaceDefinitions(Long parameterGroupId,
                                                            List<CanonicalDefinition> definitions) {
        definitionMapper.delete(new LambdaQueryWrapper<WbParameterDefinition>()
                .eq(WbParameterDefinition::getParameterGroupId, parameterGroupId));
        return insertDefinitions(parameterGroupId, definitions);
    }

    private List<WbParameterDefinition> insertDefinitions(Long parameterGroupId,
                                                           List<CanonicalDefinition> definitions) {
        List<WbParameterDefinition> saved = new ArrayList<>();
        for (CanonicalDefinition definition : definitions) {
            WbParameterDefinition entity = toEntity(parameterGroupId, definition);
            definitionMapper.insert(entity);
            saved.add(entity);
        }
        return saved;
    }

    private List<CanonicalDefinition> normalizeDefinitions(List<ParameterDefinitionRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            throw badRequest("参数组至少需要一个参数");
        }
        if (requests.size() > 200) {
            throw badRequest("单个参数组最多包含 200 个参数");
        }
        Set<String> keys = new HashSet<>();
        List<CanonicalDefinition> normalized = new ArrayList<>();
        for (int index = 0; index < requests.size(); index++) {
            ParameterDefinitionRequest request = requests.get(index);
            String key = normalizeKey(request.key());
            if (!keys.add(key)) {
                throw badRequest("参数键重复: " + key);
            }
            ParameterValueSource valueSource = parseEnum(ParameterValueSource.class, request.valueSource(), "参数来源不支持: " + key);
            int sortOrder = request.sortOrder() == null ? index : request.sortOrder();
            if (sortOrder < 0) {
                throw badRequest("参数排序值不能小于 0: " + key);
            }
            normalized.add(normalizeDefinition(request, key, valueSource, sortOrder));
        }
        return normalized.stream().sorted(canonicalOrder()).toList();
    }

    private CanonicalDefinition normalizeDefinition(ParameterDefinitionRequest request,
                                                    String key,
                                                    ParameterValueSource valueSource,
                                                    int sortOrder) {
        String description = blankToNull(request.description());
        if (valueSource == ParameterValueSource.CONSTANT) {
            String constant = normalizeConstant(request.constantValue(), key);
            return new CanonicalDefinition(key, valueSource, constant, null, null, 0,
                    description, sortOrder);
        }

        ParameterTimeBasis timeBasis = parseEnum(
                ParameterTimeBasis.class, request.timeBasis(), "时间基准不支持: " + key);
        int offsetDays = request.offsetDays() == null ? 0 : request.offsetDays();
        String format = normalizeRequired(request.format(), "时间参数必须配置格式: " + key);
        try {
            DateTimeFormatter.ofPattern(format, Locale.ROOT);
        } catch (IllegalArgumentException ex) {
            throw badRequest("时间格式不合法: " + key);
        }
        return new CanonicalDefinition(key, valueSource, null, timeBasis, format,
                offsetDays, description, sortOrder);
    }

    private String normalizeConstant(String value, String key) {
        if (value == null) {
            throw badRequest("常量参数不能为空: " + key);
        }
        return value;
    }

    private String resolveValue(CanonicalDefinition definition,
                                ParameterPreviewRequest request,
                                ZoneId runtimeTimezone) {
        if (definition.valueSource() == ParameterValueSource.CONSTANT) {
            return definition.constantValue();
        }
        LocalDateTime referenceTime = definition.timeBasis() == ParameterTimeBasis.PLANNED_TIME
                ? request.plannedTime()
                : request.executionStartTime();
        if (referenceTime == null) {
            throw badRequest("计划时间不能为空: " + definition.key());
        }
        return referenceTime.atZone(runtimeTimezone)
                .plusDays(definition.offsetDays())
                .format(DateTimeFormatter.ofPattern(definition.format(), Locale.ROOT));
    }

    private String parseOverride(CanonicalDefinition definition, String value) {
        if (value == null) {
            throw badRequest("V1 不支持 null 参数: " + definition.key());
        }
        return value;
    }

    private CanonicalDefinition fromEntity(WbParameterDefinition entity) {
        return new CanonicalDefinition(
                entity.getParameterKey(),
                ParameterValueSource.valueOf(entity.getValueSource()),
                entity.getConstantValue(),
                entity.getTimeBasis() == null ? null : ParameterTimeBasis.valueOf(entity.getTimeBasis()),
                entity.getValueFormat(),
                entity.getOffsetDays() == null ? 0 : entity.getOffsetDays(),
                entity.getDescription(),
                entity.getSortOrder()
        );
    }

    private WbParameterDefinition toEntity(Long parameterGroupId, CanonicalDefinition definition) {
        WbParameterDefinition entity = new WbParameterDefinition();
        entity.setParameterGroupId(parameterGroupId);
        entity.setParameterKey(definition.key());
        entity.setValueSource(definition.valueSource().name());
        entity.setConstantValue(definition.constantValue());
        entity.setTimeBasis(definition.timeBasis() == null ? null : definition.timeBasis().name());
        entity.setValueFormat(definition.format());
        entity.setOffsetDays(definition.offsetDays());
        entity.setDescription(definition.description());
        entity.setSortOrder(definition.sortOrder());
        return entity;
    }

    private ParameterGroupResponse toResponse(WbParameterGroup group, List<WbParameterDefinition> definitions) {
        return new ParameterGroupResponse(
                group.getId(), group.getCode(), group.getName(), group.getDescription(),
                group.getVersion(), group.getRevision(), group.getStatus(), group.getCreatedBy(), group.getUpdatedBy(),
                group.getCreatedAt(), group.getUpdatedAt(),
                definitions.stream().map(this::toDefinitionResponse).toList()
        );
    }

    private ParameterDefinitionResponse toDefinitionResponse(WbParameterDefinition definition) {
        return new ParameterDefinitionResponse(
                definition.getId(), definition.getParameterKey(), definition.getValueSource(),
                definition.getConstantValue(), definition.getTimeBasis(),
                definition.getValueFormat(), definition.getOffsetDays(),
                definition.getDescription(), definition.getSortOrder()
        );
    }

    private ParameterGroupSummaryResponse toSummary(WbParameterGroup group, long parameterCount) {
        return new ParameterGroupSummaryResponse(
                group.getId(), group.getCode(), group.getName(), group.getDescription(), group.getVersion(),
                group.getRevision(), group.getStatus(), parameterCount, group.getCreatedBy(), group.getUpdatedBy(),
                group.getCreatedAt(), group.getUpdatedAt()
        );
    }

    private Comparator<CanonicalDefinition> canonicalOrder() {
        return Comparator.comparingInt(CanonicalDefinition::sortOrder).thenComparing(CanonicalDefinition::key);
    }

    private String normalizeCode(String code) {
        String normalized = normalizeRequired(code, "参数组代码不能为空");
        if (!KEY_PATTERN.matcher(normalized).matches()) {
            throw badRequest("参数组代码格式不正确");
        }
        return normalized;
    }

    private String normalizeKey(String key) {
        String normalized = normalizeRequired(key, "参数键不能为空");
        if (!KEY_PATTERN.matcher(normalized).matches()) {
            throw badRequest("参数键格式不正确: " + normalized);
        }
        if (normalized.toLowerCase(Locale.ROOT).startsWith("wbdata_")) {
            throw badRequest("wbdata_ 前缀保留给系统使用: " + normalized);
        }
        return normalized;
    }

    private String parseStatus(String status) {
        String normalized = status.trim().toUpperCase(Locale.ROOT);
        if (!ACTIVE.equals(normalized) && !ARCHIVED.equals(normalized)) {
            throw badRequest("参数组状态不支持: " + status);
        }
        return normalized;
    }

    private <T extends Enum<T>> T parseEnum(Class<T> enumType, String value, String message) {
        if (value == null || value.isBlank()) {
            throw badRequest(message);
        }
        try {
            return Enum.valueOf(enumType, value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw badRequest(message);
        }
    }

    private ZoneId parseTimezone(String timezone) {
        String normalized = normalizeRequired(timezone, "任务运行时区不能为空");
        try {
            return ZoneId.of(normalized);
        } catch (RuntimeException ex) {
            throw badRequest("任务运行时区不合法");
        }
    }

    private String normalizeRequired(String value, String message) {
        if (value == null || value.isBlank()) {
            throw badRequest(message);
        }
        return value.trim();
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private ResponseStatusException concurrentModification() {
        return conflict("参数组已被其他操作修改，请刷新后重试");
    }

    private record CanonicalDefinition(
            String key,
            ParameterValueSource valueSource,
            String constantValue,
            ParameterTimeBasis timeBasis,
            String format,
            int offsetDays,
            String description,
            int sortOrder
    ) {
    }
}
