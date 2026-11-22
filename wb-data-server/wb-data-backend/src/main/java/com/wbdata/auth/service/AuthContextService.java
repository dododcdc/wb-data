package com.wbdata.auth.service;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.enums.SystemRole;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class AuthContextService {
    private final AuthGroupAccessPort groupAccessPort;
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
        groupAccessPort.recordGroupSelection(session.id(), context.currentGroup().id(), LocalDateTime.now());
        return context;
    }

    public List<ProjectGroupContextItem> listAccessibleGroups(AuthSession session) {
        return SystemRole.SYSTEM_ADMIN.name().equals(session.systemRole())
                ? groupAccessPort.listActiveGroupsForSystemAdmin()
                : groupAccessPort.listActiveGroupsForUser(session.id());
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
        Long preferredGroupId = groupAccessPort.findLastSelectedGroupId(userId).orElse(null);
        if (preferredGroupId != null) {
            for (ProjectGroupContextItem group : accessibleGroups) {
                if (Objects.equals(group.id(), preferredGroupId)) {
                    return group;
                }
            }
        }
        return accessibleGroups.getFirst();
    }
}
