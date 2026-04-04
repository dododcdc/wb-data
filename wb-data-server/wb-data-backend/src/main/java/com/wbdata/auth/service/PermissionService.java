package com.wbdata.auth.service;

import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class PermissionService {

    private static final List<String> GROUP_ADMIN_PERMISSIONS = List.of(
            "datasource.read",
            "datasource.write",
            "query.use",
            "query.export",
            "offline.read",
            "offline.write",
            "member.read",
            "member.manage",
            "group.settings"
    );

    private static final List<String> DEVELOPER_PERMISSIONS = List.of(
            "datasource.read",
            "query.use",
            "query.export",
            "offline.read",
            "offline.write",
            "member.read"
    );

    public List<String> resolveProjectPermissions(String role, boolean systemAdmin) {
        if (systemAdmin) {
            return GROUP_ADMIN_PERMISSIONS;
        }

        if ("GROUP_ADMIN".equals(role)) {
            return GROUP_ADMIN_PERMISSIONS;
        }

        if ("DEVELOPER".equals(role)) {
            return DEVELOPER_PERMISSIONS;
        }

        return List.of();
    }
}
