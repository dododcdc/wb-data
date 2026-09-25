package com.wbdata.auth.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.entity.WbUserGroupPreference;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.group.mapper.WbUserGroupPreferenceMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AuthContextService {
    private final WbProjectGroupMapper wbProjectGroupMapper;
    private final WbProjectGroupMemberMapper wbProjectGroupMemberMapper;
    private final WbUserGroupPreferenceMapper wbUserGroupPreferenceMapper;
    private final PermissionService permissionService;

    public AuthContextResponse getContext(AuthSession session, Long requestedGroupId) {
        boolean systemAdmin = SystemRole.SYSTEM_ADMIN.name().equals(session.systemRole());
        List<ProjectGroupContextItem> accessibleGroups = listAccessibleGroups(session);
        ProjectGroupContextItem currentGroup = resolveCurrentGroup(session.id(), systemAdmin, accessibleGroups, requestedGroupId);
        List<String> permissions = currentGroup == null
                ? List.of()
                : permissionService.resolveProjectPermissions(currentGroup.role(), systemAdmin);
        return new AuthContextResponse(session.toCurrentUserResponse(), systemAdmin, currentGroup, accessibleGroups, permissions);
    }

    public AuthContextResponse selectGroup(AuthSession session, Long groupId) {
        AuthContextResponse context = getContext(session, groupId);
        wbUserGroupPreferenceMapper.recordSelection(session.id(), context.currentGroup().id(), LocalDateTime.now());
        return context;
    }

    public List<ProjectGroupContextItem> listAccessibleGroups(AuthSession session) {
        return SystemRole.SYSTEM_ADMIN.name().equals(session.systemRole())
                ? loadSystemAdminGroups()
                : loadUserGroups(session.id());
    }

    private List<ProjectGroupContextItem> loadSystemAdminGroups() {
        return wbProjectGroupMapper.selectList(Wrappers.<WbProjectGroup>lambdaQuery()
                        .orderByDesc(WbProjectGroup::getCreatedAt))
                .stream()
                .filter(group -> "active".equals(group.getStatus()))
                .map(group -> new ProjectGroupContextItem(group.getId(), group.getName(), group.getDescription(), "SYSTEM_ADMIN"))
                .toList();
    }

    private List<ProjectGroupContextItem> loadUserGroups(Long userId) {
        List<WbProjectGroupMember> memberships = wbProjectGroupMemberMapper.selectList(
                Wrappers.<WbProjectGroupMember>lambdaQuery().eq(WbProjectGroupMember::getUserId, userId));
        if (memberships.isEmpty()) {
            return List.of();
        }
        Map<Long, WbProjectGroupMember> membershipByGroupId = memberships.stream()
                .collect(Collectors.toMap(WbProjectGroupMember::getGroupId, Function.identity(), (left, _right) -> left, LinkedHashMap::new));
        return wbProjectGroupMapper.selectBatchIds(membershipByGroupId.keySet()).stream()
                .filter(group -> "active".equals(group.getStatus()))
                .sorted(Comparator.comparing(WbProjectGroup::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(group -> new ProjectGroupContextItem(group.getId(), group.getName(), group.getDescription(),
                        membershipByGroupId.get(group.getId()).getRole()))
                .toList();
    }

    private ProjectGroupContextItem resolveCurrentGroup(Long userId, boolean systemAdmin,
                                                        List<ProjectGroupContextItem> accessibleGroups, Long requestedGroupId) {
        if (requestedGroupId != null) {
            return accessibleGroups.stream()
                    .filter(group -> Objects.equals(group.id(), requestedGroupId))
                    .findFirst()
                    .orElseThrow(() -> new ResponseStatusException(
                            systemAdmin ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN,
                            "项目组不可用或无权访问"));
        }
        if (accessibleGroups.isEmpty()) {
            return null;
        }
        WbUserGroupPreference preference = wbUserGroupPreferenceMapper.selectOne(
                new LambdaQueryWrapper<WbUserGroupPreference>()
                        .eq(WbUserGroupPreference::getUserId, userId)
                        .orderByDesc(WbUserGroupPreference::getLastAccessedAt)
                        .last("LIMIT 1"));
        if (preference != null) {
            for (ProjectGroupContextItem group : accessibleGroups) {
                if (Objects.equals(group.id(), preference.getGroupId())) {
                    return group;
                }
            }
        }
        return accessibleGroups.getFirst();
    }
}
