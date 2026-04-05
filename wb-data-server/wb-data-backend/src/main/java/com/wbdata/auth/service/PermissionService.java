package com.wbdata.auth.service;

import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.Permission;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class PermissionService {

    private static final List<String> GROUP_ADMIN_PERMISSIONS = java.util.Arrays.stream(Permission.values())
            .map(Permission::code).toList();

    private static final List<String> DEVELOPER_PERMISSIONS = List.of(
            Permission.DATASOURCE_READ.code(),
            Permission.QUERY_USE.code(),
            Permission.QUERY_EXPORT.code(),
            Permission.OFFLINE_READ.code(),
            Permission.OFFLINE_WRITE.code(),
            Permission.MEMBER_READ.code()
    );

    public List<String> resolveProjectPermissions(String role, boolean systemAdmin) {
        if (systemAdmin) {
            return GROUP_ADMIN_PERMISSIONS;
        }

        if (GroupRole.GROUP_ADMIN.name().equals(role)) {
            return GROUP_ADMIN_PERMISSIONS;
        }

        if (GroupRole.DEVELOPER.name().equals(role)) {
            return DEVELOPER_PERMISSIONS;
        }

        return List.of();
    }
}
