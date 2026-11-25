package com.wbdata.auth.context;

import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthSession;

import java.util.Set;

public record GroupAccessContext(
        AuthSession user,
        Long groupId,
        String groupName,
        String memberRole,
        boolean systemAdmin,
        Set<String> permissions
) {
    public boolean hasPermission(Permission permission) {
        return systemAdmin || (permissions != null && permissions.contains(permission.code()));
    }
}
