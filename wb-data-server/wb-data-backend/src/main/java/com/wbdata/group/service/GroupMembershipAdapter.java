package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.service.UserGroupMembershipPort;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * user 域项目组成员关系端口的适配器：封装项目组校验、成员差异同步与关联查询。
 */
@Service
@RequiredArgsConstructor
public class GroupMembershipAdapter implements UserGroupMembershipPort {

    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper groupMemberMapper;

    @Override
    public void assertGroupsExist(Collection<Long> groupIds) {
        if (groupIds == null || groupIds.isEmpty()) {
            return;
        }
        for (Long groupId : groupIds) {
            if (groupId == null || groupMapper.selectById(groupId) == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的项目组不存在");
            }
        }
    }

    @Override
    public void assignMemberships(Long userId, List<MembershipSpec> assignments, Long operatorId) {
        if (assignments == null || assignments.isEmpty()) {
            return;
        }
        for (MembershipSpec assignment : assignments) {
            WbProjectGroupMember member = new WbProjectGroupMember();
            member.setGroupId(assignment.groupId());
            member.setUserId(userId);
            member.setRole(assignment.groupRole());
            member.setCreatedBy(operatorId);
            member.setUpdatedBy(operatorId);
            groupMemberMapper.insert(member);
        }
    }

    @Override
    public void syncMemberships(Long userId, List<MembershipSpec> assignments, Long operatorId) {
        Map<Long, MembershipSpec> submittedMap = new LinkedHashMap<>();
        if (assignments != null) {
            for (MembershipSpec assignment : assignments) {
                submittedMap.put(assignment.groupId(), assignment);
            }
        }

        List<WbProjectGroupMember> existingMembers = groupMemberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getUserId, userId));

        Map<Long, WbProjectGroupMember> existingMap = new LinkedHashMap<>();
        for (WbProjectGroupMember member : existingMembers) {
            existingMap.put(member.getGroupId(), member);
        }

        for (WbProjectGroupMember member : existingMembers) {
            if (!submittedMap.containsKey(member.getGroupId())) {
                groupMemberMapper.deleteById(member.getId());
            }
        }

        for (Map.Entry<Long, MembershipSpec> entry : submittedMap.entrySet()) {
            Long groupId = entry.getKey();
            MembershipSpec assignment = entry.getValue();
            WbProjectGroupMember existingMember = existingMap.get(groupId);

            if (existingMember == null) {
                WbProjectGroupMember newMember = new WbProjectGroupMember();
                newMember.setGroupId(groupId);
                newMember.setUserId(userId);
                newMember.setRole(assignment.groupRole());
                newMember.setCreatedBy(operatorId);
                newMember.setUpdatedBy(operatorId);
                groupMemberMapper.insert(newMember);
            } else if (!assignment.groupRole().equals(existingMember.getRole())) {
                WbProjectGroupMember roleUpdate = new WbProjectGroupMember();
                roleUpdate.setId(existingMember.getId());
                roleUpdate.setRole(assignment.groupRole());
                roleUpdate.setUpdatedBy(operatorId);
                groupMemberMapper.updateById(roleUpdate);
            }
        }
    }

    @Override
    public List<AssignedGroup> listUserGroups(Long userId) {
        List<WbProjectGroupMember> members = groupMemberMapper.selectList(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getUserId, userId));
        if (members.isEmpty()) {
            return List.of();
        }
        List<Long> groupIds = members.stream().map(WbProjectGroupMember::getGroupId).toList();
        List<WbProjectGroup> groups = groupMapper.selectBatchIds(groupIds);
        Map<Long, String> groupNameMap = groups.stream()
                .collect(Collectors.toMap(WbProjectGroup::getId, WbProjectGroup::getName));
        return members.stream()
                .map(m -> new AssignedGroup(
                        m.getGroupId(),
                        groupNameMap.getOrDefault(m.getGroupId(), ""),
                        m.getRole()))
                .toList();
    }
}
