package com.wbdata.parameter.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.parameter.dto.CreateParameterGroupRequest;
import com.wbdata.parameter.dto.ParameterDefinitionRequest;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import com.wbdata.parameter.dto.ParameterGroupSummaryResponse;
import com.wbdata.parameter.dto.ParameterPreviewRequest;
import com.wbdata.parameter.dto.ParameterPreviewResponse;
import com.wbdata.parameter.dto.UpdateParameterGroupRequest;
import com.wbdata.parameter.entity.WbParameterDefinition;
import com.wbdata.parameter.entity.WbParameterGroup;
import com.wbdata.parameter.mapper.WbParameterDefinitionMapper;
import com.wbdata.parameter.mapper.WbParameterGroupMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ParameterGroupServiceTest {
    private WbParameterGroupMapper groupMapper;
    private WbParameterDefinitionMapper definitionMapper;
    private ParameterGroupService service;

    @BeforeEach
    void setUp() {
        groupMapper = Mockito.mock(WbParameterGroupMapper.class);
        definitionMapper = Mockito.mock(WbParameterDefinitionMapper.class);
        service = new ParameterGroupService(groupMapper, definitionMapper);
    }

    @Test
    void createNormalizesAndPersistsCompleteAggregate() {
        when(groupMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);
        Mockito.doAnswer(invocation -> {
            WbParameterGroup group = invocation.getArgument(0);
            group.setId(12L);
            return 1;
        }).when(groupMapper).insert(any(WbParameterGroup.class));

        ParameterGroupResponse response = service.create(4L, 9L, new CreateParameterGroupRequest(
                "daily_common",
                " 每日公共参数 ",
                " 日常任务使用 ",
                List.of(
                        constant("count", "007", 1),
                        systemTime("v_day", "PLANNED_TIME", "yyyyMMdd", -1, 2)
                )
        ));

        assertThat(response.id()).isEqualTo(12L);
        assertThat(response.version()).isEqualTo(1);
        assertThat(response.revision()).isEqualTo(1);
        assertThat(response.status()).isEqualTo("ACTIVE");
        assertThat(response.name()).isEqualTo("每日公共参数");
        assertThat(response.definitions()).extracting(it -> it.key()).containsExactly("count", "v_day");

        ArgumentCaptor<WbParameterDefinition> definition = ArgumentCaptor.forClass(WbParameterDefinition.class);
        verify(definitionMapper, Mockito.times(2)).insert(definition.capture());
        assertThat(definition.getAllValues().get(0).getConstantValue()).isEqualTo("007");
        assertThat(definition.getAllValues().get(1).getTimeBasis()).isEqualTo("PLANNED_TIME");
        assertThat(definition.getAllValues().get(1).getOffsetDays()).isEqualTo(-1);
        verify(definitionMapper, never()).delete(any(Wrapper.class));
    }

    @Test
    void createRejectsDuplicateAndReservedKeys() {
        when(groupMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);

        assertThatThrownBy(() -> service.create(4L, 9L, new CreateParameterGroupRequest(
                "daily_common", "每日参数", null,
                List.of(constant("name", "小明", 0), constant("name", "小红", 1))
        )))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("参数键重复");

        assertThatThrownBy(() -> service.create(4L, 9L, new CreateParameterGroupRequest(
                "daily_common", "每日参数", null,
                List.of(constant("wbdata_internal", "x", 0))
        )))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("保留给系统");
        verify(groupMapper, never()).insert(any(WbParameterGroup.class));
    }

    @Test
    void changedDefinitionsIncrementVersionAndReplaceDefinitions() {
        WbParameterGroup group = group(4L, 12L, 1, 4);
        when(groupMapper.selectById(12L)).thenReturn(group);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(constantEntity(12L, "name", "小明", 0)));
        when(groupMapper.update(isNull(), any(Wrapper.class))).thenReturn(1);

        ParameterGroupResponse response = service.update(4L, 12L, 9L, new UpdateParameterGroupRequest(
                4, "每日参数", null, List.of(constant("name", "小红", 0))));

        assertThat(response.version()).isEqualTo(2);
        assertThat(response.revision()).isEqualTo(5);
        assertThat(response.definitions().get(0).constantValue()).isEqualTo("小红");
        verify(definitionMapper).delete(any(Wrapper.class));
        verify(definitionMapper).insert(any(WbParameterDefinition.class));
    }

    @Test
    void metadataOnlyUpdateKeepsDefinitionVersion() {
        WbParameterGroup group = group(4L, 12L, 3, 7);
        when(groupMapper.selectById(12L)).thenReturn(group);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(constantEntity(12L, "name", "小明", 0)));
        when(groupMapper.update(isNull(), any(Wrapper.class))).thenReturn(1);

        ParameterGroupResponse response = service.update(4L, 12L, 9L, new UpdateParameterGroupRequest(
                7, "新名称", "新描述", List.of(constant("name", "小明", 0))));

        assertThat(response.version()).isEqualTo(3);
        assertThat(response.revision()).isEqualTo(8);
        assertThat(response.name()).isEqualTo("新名称");
        verify(definitionMapper, never()).delete(any(Wrapper.class));
        verify(definitionMapper, never()).insert(any(WbParameterDefinition.class));
    }

    @Test
    void identicalUpdateDoesNotAdvanceRevision() {
        WbParameterGroup group = group(4L, 12L, 3, 7);
        when(groupMapper.selectById(12L)).thenReturn(group);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(constantEntity(12L, "name", "小明", 0)));

        ParameterGroupResponse response = service.update(4L, 12L, 9L, new UpdateParameterGroupRequest(
                7, "每日参数", null, List.of(constant("name", "小明", 0))));

        assertThat(response.version()).isEqualTo(3);
        assertThat(response.revision()).isEqualTo(7);
        verify(groupMapper, never()).update(any(), any(Wrapper.class));
        verify(definitionMapper, never()).delete(any(Wrapper.class));
    }

    @Test
    void staleExpectedRevisionIsRejectedBeforeMutation() {
        when(groupMapper.selectById(12L)).thenReturn(group(4L, 12L, 4, 9));

        assertThatThrownBy(() -> service.update(4L, 12L, 9L, new UpdateParameterGroupRequest(
                3, "每日参数", null, List.of(constant("name", "小明", 0)))))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("已被其他操作修改");

        verify(groupMapper, never()).update(any(), any(Wrapper.class));
        verify(definitionMapper, never()).delete(any(Wrapper.class));
    }

    @Test
    void previewResolvesEachTimeBasisInFlowTimezoneAndStringOverrides() {
        when(groupMapper.selectById(12L)).thenReturn(group(4L, 12L, 2));
        WbParameterDefinition count = constantEntity(12L, "count", "3", 0);
        WbParameterDefinition plannedDay = systemTimeEntity(
                12L, "v_plan_day", "PLANNED_TIME", "yyyyMMdd", -1, 1);
        WbParameterDefinition startDay = systemTimeEntity(
                12L, "v_start_day", "EXECUTION_START_TIME", "yyyyMMdd", 0, 2);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(count, plannedDay, startDay));

        ParameterPreviewResponse response = service.preview(4L, 12L, new ParameterPreviewRequest(
                LocalDateTime.parse("2026-01-02T05:00:00"),
                LocalDateTime.parse("2026-01-01T02:00:00"),
                "Asia/Shanghai",
                Map.of("count", "007")
        ));

        assertThat(response.runtimeTimezone()).isEqualTo("Asia/Shanghai");
        assertThat(response.values()).extracting(it -> it.value())
                .containsExactly("007", "20251231", "20260102");
        assertThat(response.values()).extracting(it -> it.timeBasis())
                .containsExactly(null, "PLANNED_TIME", "EXECUTION_START_TIME");
        assertThat(response.values()).extracting(it -> it.overridden())
                .containsExactly(true, false, false);
    }

    @Test
    void previewRejectsMissingPlannedTimeWhenDefinitionNeedsIt() {
        when(groupMapper.selectById(12L)).thenReturn(group(4L, 12L, 2));
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(
                systemTimeEntity(12L, "v_day", "PLANNED_TIME", "yyyyMMdd", 0, 0)
        ));

        assertThatThrownBy(() -> service.preview(4L, 12L, new ParameterPreviewRequest(
                LocalDateTime.parse("2026-08-15T16:30:00"),
                null,
                "Asia/Shanghai",
                Map.of())))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("计划时间不能为空");
    }

    @Test
    void previewDoesNotRequireExecutionStartTimeWhenDefinitionsOnlyUsePlannedTime() {
        when(groupMapper.selectById(12L)).thenReturn(group(4L, 12L, 2));
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(
                systemTimeEntity(12L, "v_day", "PLANNED_TIME", "yyyyMMdd", 0, 0)
        ));

        ParameterPreviewResponse response = service.preview(4L, 12L, new ParameterPreviewRequest(
                null,
                LocalDateTime.parse("2026-08-15T02:00:00"),
                "Asia/Shanghai",
                Map.of()
        ));

        assertThat(response.executionStartTime()).isNull();
        assertThat(response.values().get(0).value()).isEqualTo("20260815");
    }

    @Test
    void previewRejectsNonexistentPlannedTimeInFlowTimezone() {
        when(groupMapper.selectById(12L)).thenReturn(group(4L, 12L, 2));
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(
                systemTimeEntity(12L, "v_day", "PLANNED_TIME", "yyyyMMdd", 0, 0)
        ));

        assertThatThrownBy(() -> service.preview(4L, 12L, new ParameterPreviewRequest(
                null,
                LocalDateTime.parse("2026-03-08T02:30:00"),
                "America/New_York",
                Map.of()
        )))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("计划时间在 Flow 运行时区中不存在");
    }

    @Test
    void previewRejectsAmbiguousExecutionStartTimeInFlowTimezone() {
        when(groupMapper.selectById(12L)).thenReturn(group(4L, 12L, 2));
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(
                systemTimeEntity(12L, "v_start", "EXECUTION_START_TIME", "yyyyMMdd", 0, 0)
        ));

        assertThatThrownBy(() -> service.preview(4L, 12L, new ParameterPreviewRequest(
                LocalDateTime.parse("2026-11-01T01:30:00"),
                null,
                "America/New_York",
                Map.of()
        )))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("执行开始时间在 Flow 运行时区中不唯一");
    }

    @Test
    void createAllowsEmptyConstantAndRejectsInvalidTimeBasis() {
        when(groupMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);
        Mockito.doAnswer(invocation -> {
            WbParameterGroup group = invocation.getArgument(0);
            group.setId(12L);
            return 1;
        }).when(groupMapper).insert(any(WbParameterGroup.class));

        ParameterGroupResponse response = service.create(4L, 9L, new CreateParameterGroupRequest(
                "daily_common", "每日参数", null, List.of(constant("empty_value", "", 0))));
        assertThat(response.definitions().get(0).constantValue()).isEmpty();

        assertThatThrownBy(() -> service.create(4L, 9L, new CreateParameterGroupRequest(
                "another_group", "每日参数", null,
                List.of(systemTime("v_day", "NOW", "yyyyMMdd", 0, 0)))))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("时间基准不支持");
    }

    @Test
    void groupScopePreventsReadingAnotherGroupsParameterGroup() {
        when(groupMapper.selectById(12L)).thenReturn(group(5L, 12L, 1));

        assertThatThrownBy(() -> service.get(4L, 12L))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("参数组不存在");
        verify(definitionMapper, never()).selectList(any(LambdaQueryWrapper.class));
    }

    @Test
    void listReturnsParameterCountsWithoutOneQueryPerGroup() {
        WbParameterGroup first = group(4L, 12L, 1);
        WbParameterGroup second = group(4L, 13L, 2);
        Page<WbParameterGroup> page = new Page<>(1, 10, 2);
        page.setRecords(List.of(first, second));
        when(groupMapper.selectPage(any(Page.class), any(LambdaQueryWrapper.class))).thenReturn(page);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(
                constantEntity(12L, "a", "1", 0),
                constantEntity(12L, "b", "2", 1),
                constantEntity(13L, "c", "3", 0)
        ));

        PageResult<ParameterGroupSummaryResponse> result = service.list(4L, new PageQuery(), "ACTIVE");

        assertThat(result.getRecords()).extracting(ParameterGroupSummaryResponse::parameterCount)
                .containsExactly(2L, 1L);
        verify(definitionMapper, Mockito.times(1)).selectList(any(LambdaQueryWrapper.class));
    }

    @Test
    void archiveChangesStatusWithoutChangingVersion() {
        WbParameterGroup group = group(4L, 12L, 3, 6);
        when(groupMapper.selectById(12L)).thenReturn(group);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(constantEntity(12L, "name", "小明", 0)));
        when(groupMapper.update(isNull(), any(Wrapper.class))).thenReturn(1);

        ParameterGroupResponse response = service.archive(4L, 12L, 9L);

        assertThat(response.status()).isEqualTo("ARCHIVED");
        assertThat(response.version()).isEqualTo(3);
        assertThat(response.revision()).isEqualTo(7);
        verify(groupMapper).update(isNull(), any(Wrapper.class));
        verify(groupMapper, never()).updateById(any(WbParameterGroup.class));
    }

    @Test
    void findByCodeReturnsCurrentAggregateForFlowStatusResolution() {
        WbParameterGroup group = group(4L, 12L, 3);
        when(groupMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(group);
        when(definitionMapper.selectList(any(LambdaQueryWrapper.class)))
                .thenReturn(List.of(constantEntity(12L, "name", "小明", 0)));

        var result = service.findByCode(4L, "daily_common");

        assertThat(result).isPresent();
        assertThat(result.orElseThrow().version()).isEqualTo(3);
        assertThat(result.orElseThrow().definitions()).extracting(it -> it.key()).containsExactly("name");
    }

    private WbParameterGroup group(Long groupId, Long id, int version) {
        return group(groupId, id, version, 1);
    }

    private WbParameterGroup group(Long groupId, Long id, int version, int revision) {
        WbParameterGroup group = new WbParameterGroup();
        group.setId(id);
        group.setGroupId(groupId);
        group.setCode("daily_common");
        group.setName("每日参数");
        group.setVersion(version);
        group.setRevision(revision);
        group.setStatus("ACTIVE");
        group.setCreatedBy(8L);
        group.setUpdatedBy(8L);
        return group;
    }

    private ParameterDefinitionRequest constant(String key, String value, int sortOrder) {
        return new ParameterDefinitionRequest(
                key, "CONSTANT", value, null, null, null, null, sortOrder);
    }

    private ParameterDefinitionRequest systemTime(String key,
                                                  String timeBasis,
                                                  String format,
                                                  int offset,
                                                  int sortOrder) {
        return new ParameterDefinitionRequest(
                key, "SYSTEM_TIME", null, timeBasis, format, offset, null, sortOrder);
    }

    private WbParameterDefinition constantEntity(Long groupId, String key, String value, int sortOrder) {
        WbParameterDefinition definition = new WbParameterDefinition();
        definition.setId((long) sortOrder + 1);
        definition.setParameterGroupId(groupId);
        definition.setParameterKey(key);
        definition.setValueSource("CONSTANT");
        definition.setConstantValue(value);
        definition.setOffsetDays(0);
        definition.setSortOrder(sortOrder);
        return definition;
    }

    private WbParameterDefinition systemTimeEntity(Long groupId,
                                                   String key,
                                                   String timeBasis,
                                                   String format,
                                                   int offset,
                                                   int sortOrder) {
        WbParameterDefinition definition = new WbParameterDefinition();
        definition.setId((long) sortOrder + 1);
        definition.setParameterGroupId(groupId);
        definition.setParameterKey(key);
        definition.setValueSource("SYSTEM_TIME");
        definition.setTimeBasis(timeBasis);
        definition.setValueFormat(format);
        definition.setOffsetDays(offset);
        definition.setSortOrder(sortOrder);
        return definition;
    }
}
