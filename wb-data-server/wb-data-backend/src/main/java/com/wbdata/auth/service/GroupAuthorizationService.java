package com.wbdata.auth.service;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.enums.SystemRole;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class GroupAuthorizationService {
    private final AuthGroupAccessPort groupAccessPort;
    private final PermissionService permissionService;

    public GroupAuthContext requireGroup(AuthSession session, Long groupId, Permission permission) {
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
        if (!permissionService.resolveProjectPermissions(group.memberRole(), systemAdmin).contains(permission.code())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission.code());
        }
        return new GroupAuthContext(session, group.id(), group.name());
    }
}
