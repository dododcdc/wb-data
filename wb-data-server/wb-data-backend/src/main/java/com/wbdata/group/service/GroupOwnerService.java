package com.wbdata.group.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.dto.AssetOwnerSummaryResponse;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.GroupOwnerOptionResponse;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class GroupOwnerService {

    private static final String ACTIVE_STATUS = "ACTIVE";

    private final WbProjectGroupMemberMapper memberMapper;
    private final WbUserMapper userMapper;

    public List<GroupOwnerOptionResponse> listOwnerCandidates(Long groupId) {
        List<WbProjectGroupMember> members = memberMapper.selectList(new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId));

        Set<Long> memberUserIds = members.stream()
                .map(WbProjectGroupMember::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());

        Map<Long, WbUser> memberUsers = memberUserIds.isEmpty()
                ? Map.of()
                : userMapper.selectBatchIds(memberUserIds).stream()
                        .filter(user -> ACTIVE_STATUS.equals(user.getStatus()))
                        .collect(Collectors.toMap(WbUser::getId, Function.identity()));

        Map<Long, GroupOwnerOptionResponse> options = new LinkedHashMap<>();
        for (WbProjectGroupMember member : members) {
            WbUser user = memberUsers.get(member.getUserId());
            if (user == null) {
                continue;
            }
            options.putIfAbsent(user.getId(), new GroupOwnerOptionResponse(
                    user.getId(),
                    user.getUsername(),
                    user.getDisplayName(),
                    member.getRole()
            ));
        }

        List<WbUser> admins = userMapper.selectList(new LambdaQueryWrapper<WbUser>()
                .eq(WbUser::getStatus, ACTIVE_STATUS)
                .eq(WbUser::getSystemRole, SystemRole.SYSTEM_ADMIN.name()));
        for (WbUser admin : admins) {
            options.putIfAbsent(admin.getId(), new GroupOwnerOptionResponse(
                    admin.getId(),
                    admin.getUsername(),
                    admin.getDisplayName(),
                    SystemRole.SYSTEM_ADMIN.name()
            ));
        }

        return options.values().stream()
                .sorted(Comparator
                        .comparingInt((GroupOwnerOptionResponse o) -> roleRank(o.role()))
                        .thenComparing(o -> effectiveName(o.displayName(), o.username()), String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    public GroupOwnerInfo requireAssignableOwner(Long groupId, Long ownerUserId) {
        if (ownerUserId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "负责人不能为空");
        }
        WbUser user = userMapper.selectById(ownerUserId);
        if (user == null || !ACTIVE_STATUS.equals(user.getStatus())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的负责人不存在或已停用");
        }
        boolean isSystemAdmin = SystemRole.SYSTEM_ADMIN.name().equals(user.getSystemRole());
        boolean isMember = isSystemAdmin || memberMapper.exists(new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId)
                .eq(WbProjectGroupMember::getUserId, ownerUserId));
        if (!isMember) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的负责人不是当前项目组的有效成员");
        }
        return new GroupOwnerInfo(user.getId(), user.getUsername(), user.getDisplayName(), ACTIVE_STATUS);
    }

    public boolean canManageOthersOwnership(Long groupId, Long operatorUserId) {
        if (operatorUserId == null) {
            return false;
        }
        WbUser user = userMapper.selectById(operatorUserId);
        if (user != null && ACTIVE_STATUS.equals(user.getStatus())
                && SystemRole.SYSTEM_ADMIN.name().equals(user.getSystemRole())) {
            return true;
        }
        return memberMapper.exists(new LambdaQueryWrapper<WbProjectGroupMember>()
                .eq(WbProjectGroupMember::getGroupId, groupId)
                .eq(WbProjectGroupMember::getUserId, operatorUserId)
                .eq(WbProjectGroupMember::getRole, GroupRole.GROUP_ADMIN.name()));
    }

    public Map<Long, GroupOwnerInfo> resolveOwners(Long groupId, Collection<Long> ownerUserIds) {
        if (ownerUserIds == null || ownerUserIds.isEmpty()) {
            return Map.of();
        }
        Set<Long> distinctIds = ownerUserIds.stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (distinctIds.isEmpty()) {
            return Map.of();
        }

        Map<Long, WbUser> users = userMapper.selectBatchIds(distinctIds).stream()
                .collect(Collectors.toMap(WbUser::getId, Function.identity()));

        Set<Long> memberUserIds = memberMapper.selectList(new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId)
                        .in(WbProjectGroupMember::getUserId, distinctIds))
                .stream()
                .map(WbProjectGroupMember::getUserId)
                .collect(Collectors.toSet());

        Map<Long, GroupOwnerInfo> resolved = new HashMap<>(distinctIds.size());
        for (Long id : distinctIds) {
            WbUser user = users.get(id);
            if (user == null) {
                continue;
            }
            String status;
            if (!ACTIVE_STATUS.equals(user.getStatus())) {
                status = "DISABLED";
            } else if (SystemRole.SYSTEM_ADMIN.name().equals(user.getSystemRole()) || memberUserIds.contains(id)) {
                status = ACTIVE_STATUS;
            } else {
                status = "LEFT_GROUP";
            }
            resolved.put(id, new GroupOwnerInfo(user.getId(), user.getUsername(), user.getDisplayName(), status));
        }
        return resolved;
    }

    public List<AssetOwnerSummaryResponse> summarizeOwners(Long groupId, Map<Long, Long> ownerCounts) {
        if (ownerCounts == null || ownerCounts.isEmpty()) {
            return List.of();
        }
        Map<Long, GroupOwnerInfo> ownerMap = resolveOwners(groupId, ownerCounts.keySet());
        return ownerCounts.entrySet().stream()
                .filter(entry -> entry.getKey() != null && entry.getValue() != null && entry.getValue() > 0)
                .map(entry -> {
                    Long userId = entry.getKey();
                    GroupOwnerInfo info = ownerMap.get(userId);
                    return new AssetOwnerSummaryResponse(
                            userId,
                            info != null ? info.username() : null,
                            info != null ? info.displayName() : null,
                            info != null ? info.status() : "UNKNOWN",
                            entry.getValue()
                    );
                })
                .sorted(Comparator
                        .comparingLong(AssetOwnerSummaryResponse::count).reversed()
                        .thenComparing(o -> effectiveName(o.displayName(), o.username()), String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    private static int roleRank(String role) {
        if (GroupRole.GROUP_ADMIN.name().equals(role)) {
            return 0;
        }
        if (GroupRole.DEVELOPER.name().equals(role)) {
            return 1;
        }
        if (SystemRole.SYSTEM_ADMIN.name().equals(role)) {
            return 2;
        }
        return 3;
    }

    private static String effectiveName(String displayName, String username) {
        if (displayName != null && !displayName.isBlank()) {
            return displayName.trim();
        }
        return username != null ? username : "";
    }
}
