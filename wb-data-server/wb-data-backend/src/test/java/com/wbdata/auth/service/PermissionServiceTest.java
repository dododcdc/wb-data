package com.wbdata.auth.service;

import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.Permission;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PermissionServiceTest {
    private final PermissionService service = new PermissionService();

    @Test
    void developerCanReadAndWriteParameterGroups() {
        assertThat(service.resolveProjectPermissions(GroupRole.DEVELOPER.name(), false))
                .contains(Permission.PARAMETER_READ.code(), Permission.PARAMETER_WRITE.code());
    }

    @Test
    void unknownAndMissingGroupRolesHaveNoPermissions() {
        assertThat(service.resolveProjectPermissions(null, false)).isEmpty();
        assertThat(service.resolveProjectPermissions("UNKNOWN", false)).isEmpty();
    }

    @Test
    void developerCannotManageMembersSettingsOrDataSources() {
        assertThat(service.resolveProjectPermissions(GroupRole.DEVELOPER.name(), false))
                .doesNotContain(Permission.MEMBER_MANAGE.code(), Permission.GROUP_SETTINGS.code(),
                        Permission.DATASOURCE_WRITE.code());
    }

    @Test
    void groupAndSystemAdminsReceiveAllPermissions() {
        assertThat(service.resolveProjectPermissions(GroupRole.GROUP_ADMIN.name(), false))
                .containsExactlyInAnyOrderElementsOf(
                        java.util.Arrays.stream(Permission.values()).map(Permission::code).toList());
        assertThat(service.resolveProjectPermissions(null, true))
                .containsExactlyInAnyOrderElementsOf(
                        java.util.Arrays.stream(Permission.values()).map(Permission::code).toList());
    }
}
