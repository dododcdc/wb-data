package com.wbdata.offline.config;

import com.wbdata.auth.context.GroupAccessContext;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.GroupAuthorizationService;
import com.wbdata.offline.repo.service.GitCommandService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * 受保护分支写操作守卫：
 * 在 {@code main} 分支上仅项目组管理员或系统管理员（具备 {@code GROUP_SETTINGS}）可直接修改或推送，
 * 普通开发者可在开发分支正常编辑提交，在 {@code main} 上保持只读查看与排障。
 */
@Component
@RequiredArgsConstructor
public class OfflineBranchGuard {

    private final GitCommandService gitCommandService;
    private final GroupAuthorizationService groupAuthorizationService;

    public void assertCanWriteCurrentBranch(GroupAuthContext context) {
        if (context == null || context.groupId() == null) {
            return;
        }
        String activeBranch = resolveActiveBranch(context.groupId());
        if (!OfflineBranchContext.MAIN_BRANCH.equals(activeBranch)) {
            return;
        }
        if (context.user() != null && groupAuthorizationService != null) {
            GroupAccessContext access = groupAuthorizationService.requireGroupAccess(context.user(), context.groupId());
            if (access.hasPermission(Permission.GROUP_SETTINGS)) {
                return;
            }
        }
        throw new ResponseStatusException(
                HttpStatus.FORBIDDEN,
                "main 分支受保护，仅项目组管理员或系统管理员可直接修改或推送，请新建或切换到开发分支"
        );
    }

    public String resolveActiveBranch(Long groupId) {
        String fromContext = OfflineBranchContext.currentBranch(groupId);
        if (fromContext != null && !fromContext.isBlank()) {
            return fromContext;
        }
        String fromRepo = gitCommandService.getCurrentBranch(groupId);
        return fromRepo == null || fromRepo.isBlank() ? OfflineBranchContext.MAIN_BRANCH : fromRepo;
    }
}
