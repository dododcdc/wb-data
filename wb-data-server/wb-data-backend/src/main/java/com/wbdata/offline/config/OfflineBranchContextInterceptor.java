package com.wbdata.offline.config;

import com.wbdata.offline.repo.service.GitWorktreeManager;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;

/**
 * 解析请求头 {@code X-Offline-Branch}（或查询参数 {@code branch}），
 * 将当前请求绑定到对应项目组 + 分支的 Git worktree。
 */
@Component
@RequiredArgsConstructor
public class OfflineBranchContextInterceptor implements HandlerInterceptor {

    private static final String ATTR_PUSHED = OfflineBranchContextInterceptor.class.getName() + ".PUSHED";

    private final OfflineProperties offlineProperties;
    private final GitWorktreeManager worktreeManager;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String branch = resolveBranch(request);
        if (branch == null) {
            return true;
        }
        Long groupId = resolveGroupId(request);
        if (groupId == null) {
            return true;
        }
        Path primaryRepo = offlineProperties.resolvePrimaryRepoPath(groupId);
        if (!OfflineProperties.isGitRepoInitialized(primaryRepo)) {
            return true;
        }

        String uri = request.getRequestURI();
        boolean nonBlockingLookup = isDiscoveryOrBranchControlEndpoint(uri);
        Optional<Path> existing = worktreeManager.findExistingWorktree(groupId, branch);
        Path worktreePath;
        if (existing.isPresent()) {
            worktreePath = existing.get();
        } else if (nonBlockingLookup) {
            // 状态检查与分支管理接口允许缺失/已删分支降级回主仓，避免阻断分支自愈切换
            return true;
        } else {
            worktreePath = worktreeManager.resolveOrCreateWorktree(groupId, branch);
        }

        OfflineBranchContext.push(groupId, branch, worktreePath);
        request.setAttribute(ATTR_PUSHED, Boolean.TRUE);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                                HttpServletResponse response,
                                Object handler,
                                @Nullable Exception ex) {
        if (Boolean.TRUE.equals(request.getAttribute(ATTR_PUSHED))) {
            request.removeAttribute(ATTR_PUSHED);
            OfflineBranchContext.pop();
        }
    }

    @Nullable
    private String resolveBranch(HttpServletRequest request) {
        String header = request.getHeader(OfflineBranchContext.HEADER_NAME);
        if (header != null && !header.isBlank()) {
            return header.trim();
        }
        String param = request.getParameter("branch");
        if (param != null && !param.isBlank()) {
            return param.trim();
        }
        return null;
    }

    @Nullable
    private Long resolveGroupId(HttpServletRequest request) {
        Object pathVars = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        if (pathVars instanceof Map<?, ?> variables && variables.get("groupId") != null) {
            Long parsed = parsePositiveLong(variables.get("groupId").toString());
            if (parsed != null) {
                return parsed;
            }
        }
        String queryGroupId = request.getParameter("groupId");
        return parsePositiveLong(queryGroupId);
    }

    @Nullable
    private Long parsePositiveLong(@Nullable String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = Long.parseLong(raw.trim());
            return value > 0 ? value : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private boolean isDiscoveryOrBranchControlEndpoint(@Nullable String uri) {
        if (uri == null) {
            return false;
        }
        return uri.endsWith("/repo/status")
                || uri.endsWith("/repo/branches")
                || uri.endsWith("/repo/remote")
                || uri.endsWith("/repo/branch")
                || uri.endsWith("/repo/branch/switch")
                || uri.endsWith("/repo/branch/merge");
    }
}
