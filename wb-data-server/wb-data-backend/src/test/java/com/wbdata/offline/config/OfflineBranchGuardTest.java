package com.wbdata.offline.config;

import com.wbdata.auth.context.GroupAccessContext;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.GroupAuthorizationService;
import com.wbdata.offline.repo.service.GitCommandService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfflineBranchGuardTest {

    @AfterEach
    void clearContext() {
        OfflineBranchContext.clear();
    }

    @Test
    void rejectsDeveloperWritingOnMainBranchButAllowsFeatureBranchAndGroupAdmin() {
        GitCommandService gitCommandService = mock(GitCommandService.class);
        GroupAuthorizationService groupAuthorizationService = mock(GroupAuthorizationService.class);
        when(gitCommandService.getCurrentBranch(1L)).thenReturn("main");

        AuthSession devSession = new AuthSession(10L, "dev1", "开发者", "USER", Instant.now());
        AuthSession adminSession = new AuthSession(1L, "admin", "管理员", "SYSTEM_ADMIN", Instant.now());
        GroupAuthContext developer = new GroupAuthContext(devSession, 1L, "Policy");
        GroupAuthContext groupAdmin = new GroupAuthContext(adminSession, 1L, "Policy");

        when(groupAuthorizationService.requireGroupAccess(devSession, 1L)).thenReturn(
                new GroupAccessContext(devSession, 1L, "Policy", GroupRole.DEVELOPER.name(), false,
                        Set.of(Permission.OFFLINE_READ.code(), Permission.OFFLINE_WRITE.code()))
        );
        when(groupAuthorizationService.requireGroupAccess(adminSession, 1L)).thenReturn(
                new GroupAccessContext(adminSession, 1L, "Policy", GroupRole.GROUP_ADMIN.name(), true,
                        Set.of(Permission.OFFLINE_READ.code(), Permission.OFFLINE_WRITE.code(), Permission.GROUP_SETTINGS.code()))
        );

        OfflineBranchGuard guard = new OfflineBranchGuard(gitCommandService, groupAuthorizationService);

        ResponseStatusException forbidden = assertThrows(ResponseStatusException.class,
                () -> guard.assertCanWriteCurrentBranch(developer));
        assertThat(forbidden.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(forbidden.getReason()).contains("main 分支受保护");

        assertDoesNotThrow(() -> guard.assertCanWriteCurrentBranch(groupAdmin));

        OfflineBranchContext.withWorkspace(1L, "feature/a", Path.of("/tmp/wt-feature-a"),
                () -> assertDoesNotThrow(() -> guard.assertCanWriteCurrentBranch(developer)));
    }
}
