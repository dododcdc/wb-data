package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.dto.GroupDetailResponse;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.dto.GroupSimpleResponse;
import lombok.RequiredArgsConstructor;
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

    public List<GroupSimpleResponse> listAll() {
        List<WbProjectGroup> groups = groupMapper.selectList(null);
        return groups.stream()
                .map(GroupSimpleResponse::from)
                .collect(Collectors.toList());
    }

    public IPage<GroupDetailResponse> listGroups(int page, int size, String keyword) {
        Page<WbProjectGroup> pageParam = new Page<>(page, size);
        LambdaQueryWrapper<WbProjectGroup> wrapper = new LambdaQueryWrapper<>();

        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            wrapper.like(WbProjectGroup::getName, kw);
        }

        wrapper.orderByDesc(WbProjectGroup::getCreatedAt);
        IPage<WbProjectGroup> result = groupMapper.selectPage(pageParam, wrapper);

        List<WbProjectGroup> records = result.getRecords();
        if (records.isEmpty()) {
            return result.convert(g -> GroupDetailResponse.from(g, 0L));
        }

        List<Long> groupIds = records.stream().map(WbProjectGroup::getId).toList();
        Map<Long, Long> memberCountMap = countMembersByGroupIds(groupIds);

        return result.convert(g ->
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

    private Map<Long, Long> countMembersByGroupIds(List<Long> groupIds) {
        List<WbProjectGroupMember> members = groupMemberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .in(WbProjectGroupMember::getGroupId, groupIds));
        return members.stream()
                .collect(Collectors.groupingBy(WbProjectGroupMember::getGroupId, Collectors.counting()));
    }
}
