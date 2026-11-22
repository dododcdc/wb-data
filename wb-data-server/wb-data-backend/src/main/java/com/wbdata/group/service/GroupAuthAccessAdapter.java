package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.AuthGroupAccessPort;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.entity.WbUserGroupPreference;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.group.mapper.WbUserGroupPreferenceMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * auth 域项目组访问端口的适配器：聚合组表、成员关系与用户最近选组偏好的读取写入。
 */
@Service
@RequiredArgsConstructor
public class GroupAuthAccessAdapter implements AuthGroupAccessPort {

    private final WbProjectGroupMapper groupMapper;
    private final WbProjectGroupMemberMapper memberMapper;
    private final WbUserGroupPreferenceMapper preferenceMapper;

    @Override
    public List<ProjectGroupContextItem> listActiveGroupsForSystemAdmin() {
        return groupMapper.selectList(Wrappers.<WbProjectGroup>lambdaQuery()
                        .orderByDesc(WbProjectGroup::getCreatedAt))
                .stream()
                .filter(group -> "active".equals(group.getStatus()))
                .map(group -> new ProjectGroupContextItem(
                        group.getId(), group.getName(), group.getDescription(), "SYSTEM_ADMIN"))
                .toList();
    }

    @Override
    public List<ProjectGroupContextItem> listActiveGroupsForUser(Long userId) {
        List<WbProjectGroupMember> memberships = memberMapper.selectList(
                Wrappers.<WbProjectGroupMember>lambdaQuery().eq(WbProjectGroupMember::getUserId, userId));
        if (memberships.isEmpty()) {
            return List.of();
        }
        Map<Long, WbProjectGroupMember> membershipByGroupId = memberships.stream()
                .collect(Collectors.toMap(
                        WbProjectGroupMember::getGroupId,
                        Function.identity(),
                        (left, _right) -> left,
                        LinkedHashMap::new));
        return groupMapper.selectBatchIds(membershipByGroupId.keySet()).stream()
                .filter(group -> "active".equals(group.getStatus()))
                .sorted(Comparator.comparing(WbProjectGroup::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(group -> new ProjectGroupContextItem(
                        group.getId(),
                        group.getName(),
                        group.getDescription(),
                        membershipByGroupId.get(group.getId()).getRole()))
                .toList();
    }

    @Override
    public Optional<AuthGroupSnapshot> findGroupAccess(Long groupId, Long userId, boolean includeMembership) {
        WbProjectGroup group = groupMapper.selectById(groupId);
        if (group == null) {
            return Optional.empty();
        }
        if (!"active".equals(group.getStatus()) || !includeMembership) {
            return Optional.of(new AuthGroupSnapshot(group.getId(), group.getName(), group.getStatus(), null));
        }
        WbProjectGroupMember member = memberMapper.selectOne(Wrappers.<WbProjectGroupMember>lambdaQuery()
                .eq(WbProjectGroupMember::getGroupId, groupId)
                .eq(WbProjectGroupMember::getUserId, userId));
        return Optional.of(new AuthGroupSnapshot(
                group.getId(),
                group.getName(),
                group.getStatus(),
                member == null ? null : member.getRole()));
    }

    @Override
    public Optional<Long> findLastSelectedGroupId(Long userId) {
        WbUserGroupPreference preference = preferenceMapper.selectOne(
                new LambdaQueryWrapper<WbUserGroupPreference>()
                        .eq(WbUserGroupPreference::getUserId, userId)
                        .orderByDesc(WbUserGroupPreference::getLastAccessedAt)
                        .last("LIMIT 1"));
        return Optional.ofNullable(preference).map(WbUserGroupPreference::getGroupId);
    }

    @Override
    public void recordGroupSelection(Long userId, Long groupId, LocalDateTime accessedAt) {
        preferenceMapper.recordSelection(userId, groupId, accessedAt);
    }
}
