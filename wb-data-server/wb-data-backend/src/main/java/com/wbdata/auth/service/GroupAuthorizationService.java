package com.wbdata.auth.service;

import com.wbdata.auth.context.GroupAccessContext;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.enums.SystemRole;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Set;

@Service
@RequiredArgsConstructor
public class GroupAuthorizationService {
    private final AuthGroupAccessPort groupAccessPort;
    private final PermissionService permissionService;

    public GroupAuthContext requireGroup(AuthSession session, Long groupId, Permission permission) {
        GroupAccessContext access = requireGroupAccess(session, groupId);
        if (!access.hasPermission(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission.code());
        }
        return new GroupAuthContext(session, access.groupId(), access.groupName());
    }

    public GroupAccessContext requireGroupAccess(AuthSession session, Long groupId) {
        boolean systemAdmin = SystemRole.SYSTEM_ADMIN.name().equals(session.systemRole());
        AuthGroupAccessPort.AuthGroupSnapshot group = groupAccessPort
                .findGroupAccess(groupId, session.id(), !systemAdmin)
                .orElseThrow(() -> new ResponseStatusException(
                        systemAdmin ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN,
                        "项目组不存在或无权访问"));
        if (!"active".equals(group.status())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "项目组已禁用");
        }
        if (!systemAdmin && group.memberRole() == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权访问该项目组");
        }
        Set<String> resolvedPermissions = Set.copyOf(
                permissionService.resolveProjectPermissions(group.memberRole(), systemAdmin));
        return new GroupAccessContext(
                session,
                group.id(),
                group.name(),
                group.memberRole(),
                systemAdmin,
                resolvedPermissions
        );
    }
}
