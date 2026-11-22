package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.dto.GroupDetailResponse;
import com.wbdata.group.dto.UpdateGroupRequest;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GroupService {

    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper groupMemberMapper;
    private final ApplicationEventPublisher eventPublisher;

    public PageResult<GroupDetailResponse> listGroups(PageQuery query) {
        Page<WbProjectGroup> pageParam = query.toMyBatisPage();
        LambdaQueryWrapper<WbProjectGroup> wrapper = new LambdaQueryWrapper<>();

        if (query.getKeyword() != null && !query.getKeyword().isBlank()) {
            String kw = "%" + query.getKeyword().trim() + "%";
            wrapper.like(WbProjectGroup::getName, kw);
        }

        wrapper.orderByDesc(WbProjectGroup::getCreatedAt);
        IPage<WbProjectGroup> result = groupMapper.selectPage(pageParam, wrapper);

        List<WbProjectGroup> records = result.getRecords();
        if (records.isEmpty()) {
            return PageResult.of(result).convert(g -> GroupDetailResponse.from(g, 0L));
        }

        List<Long> groupIds = records.stream().map(WbProjectGroup::getId).toList();
        Map<Long, Long> memberCountMap = countMembersByGroupIds(groupIds);

        return PageResult.of(result).convert(g ->
                GroupDetailResponse.from(g, memberCountMap.getOrDefault(g.getId(), 0L)));
    }

    @Transactional
    public GroupDetailResponse createGroup(CreateGroupRequest req, Long operatorId) {
        boolean exists = groupMapper.exists(new LambdaQueryWrapper<WbProjectGroup>()
                .eq(WbProjectGroup::getName, req.getName()));
        if (exists) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目组名称已存在");
        }

        WbProjectGroup group = new WbProjectGroup();
        group.setName(req.getName());
        group.setDescription(req.getDescription());
        group.setCreatedBy(operatorId);
        group.setUpdatedBy(operatorId);
        groupMapper.insert(group);

        eventPublisher.publishEvent(new GroupCreatedEvent(group.getId()));

        return GroupDetailResponse.from(groupMapper.selectById(group.getId()), 0L);
    }

    @Transactional
    public void deleteGroup(Long groupId) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }

        long memberCount = groupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));
        if (memberCount > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该项目组尚有成员，无法删除");
        }

        groupMapper.deleteById(groupId);
    }

    @Transactional
    public GroupDetailResponse updateGroup(Long groupId, UpdateGroupRequest req, Long operatorId) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }

        boolean exists = groupMapper.exists(new LambdaQueryWrapper<WbProjectGroup>()
                .eq(WbProjectGroup::getName, req.name())
                .ne(WbProjectGroup::getId, groupId));
        if (exists) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "项目组名称已存在");
        }

        group.setName(req.name());
        group.setDescription(req.description());
        group.setUpdatedBy(operatorId);
        groupMapper.updateById(group);

        long memberCount = groupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));

        return GroupDetailResponse.from(group, memberCount);
    }

    @Transactional
    public GroupDetailResponse disableGroup(Long groupId) {
        return setGroupStatus(groupId, "disabled");
    }

    @Transactional
    public GroupDetailResponse enableGroup(Long groupId) {
        return setGroupStatus(groupId, "active");
    }

    private GroupDetailResponse setGroupStatus(Long groupId, String status) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }
        group.setStatus(status);
        groupMapper.updateById(group);
        long memberCount = groupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId));
        return GroupDetailResponse.from(group, memberCount);
    }

    private Map<Long, Long> countMembersByGroupIds(List<Long> groupIds) {
        // 使用 selectMaps 直接在数据库层面进行 GROUP BY 聚合
        List<Map<String, Object>> counts = groupMemberMapper.selectMaps(
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<WbProjectGroupMember>()
                        .select("group_id", "COUNT(*) as count")
                        .in("group_id", groupIds)
                        .groupBy("group_id")
        );

        return counts.stream().collect(Collectors.toMap(
                m -> (Long) m.get("group_id"),
                m -> ((Number) m.get("count")).longValue()
        ));
    }
}
