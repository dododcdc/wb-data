package com.wbdata.workspace.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.auth.context.GroupAccessContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.git.dto.GitSyncConfigListResponse;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.repo.dto.OfflineRepoStatusResponse;
import com.wbdata.offline.repo.dto.OfflineRepoTreeNodeResponse;
import com.wbdata.offline.repo.dto.OfflineRepoTreeResponse;
import com.wbdata.offline.repo.service.OfflineRepoStatusService;
import com.wbdata.offline.service.OfflineBranchSummaryService;
import com.wbdata.offline.service.OfflineFlowIndexService;
import com.wbdata.offline.service.OfflineRecentFlowService;
import com.wbdata.offline.service.OfflineRepoTreeService;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionStatusCounts;
import com.wbdata.operations.service.OperationsExecutionService;
import com.wbdata.parameter.entity.WbParameterGroup;
import com.wbdata.parameter.mapper.WbParameterGroupMapper;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.DataSourceBrief;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.DataSourceSummary;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.DataSourceTypeCount;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.GitSyncSummary;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.MemberSummary;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.OfflineSummary;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.OperationsSummary;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.ParameterSummary;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse.RecentFlowItem;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
public class WorkspaceSummaryService {

    public static final String DEFAULT_BRANCH = "main";

    private static final int MAX_DATASOURCE_ITEMS = 10;
    private static final int MAX_RECENT_FLOWS = 4;
    private static final int MAX_EXECUTIONS = 8;
    private static final int OPERATIONS_FETCH_SIZE = 50;
    private static final Set<String> ATTENTION_STATUSES = Set.of(
            "FAILED", "RUNNING", "PAUSED", "RETRYING", "CREATED", "QUEUED"
    );

    private final DataSourceMapper dataSourceMapper;
    private final OfflineRepoStatusService offlineRepoStatusService;
    private final OfflineRepoTreeService offlineRepoTreeService;
    private final OfflineBranchSummaryService offlineBranchSummaryService;
    private final OperationsExecutionService operationsExecutionService;
    private final WbParameterGroupMapper parameterGroupMapper;
    private final GitSyncConfigService gitSyncConfigService;
    private final WbProjectGroupMemberMapper projectGroupMemberMapper;
    @Nullable
    private final OfflineFlowIndexService offlineFlowIndexService;
    @Nullable
    private final OfflineRecentFlowService offlineRecentFlowService;

    public WorkspaceSummaryService(DataSourceMapper dataSourceMapper,
                                   OfflineRepoStatusService offlineRepoStatusService,
                                   OfflineRepoTreeService offlineRepoTreeService,
                                   OfflineBranchSummaryService offlineBranchSummaryService,
                                   OperationsExecutionService operationsExecutionService,
                                   WbParameterGroupMapper parameterGroupMapper,
                                   GitSyncConfigService gitSyncConfigService,
                                   WbProjectGroupMemberMapper projectGroupMemberMapper) {
        this(
                dataSourceMapper,
                offlineRepoStatusService,
                offlineRepoTreeService,
                offlineBranchSummaryService,
                operationsExecutionService,
                parameterGroupMapper,
                gitSyncConfigService,
                projectGroupMemberMapper,
                null,
                null
        );
    }

    @Autowired
    public WorkspaceSummaryService(DataSourceMapper dataSourceMapper,
                                   OfflineRepoStatusService offlineRepoStatusService,
                                   OfflineRepoTreeService offlineRepoTreeService,
                                   OfflineBranchSummaryService offlineBranchSummaryService,
                                   OperationsExecutionService operationsExecutionService,
                                   WbParameterGroupMapper parameterGroupMapper,
                                   GitSyncConfigService gitSyncConfigService,
                                   WbProjectGroupMemberMapper projectGroupMemberMapper,
                                   @Nullable OfflineFlowIndexService offlineFlowIndexService,
                                   @Nullable OfflineRecentFlowService offlineRecentFlowService) {
        this.dataSourceMapper = dataSourceMapper;
        this.offlineRepoStatusService = offlineRepoStatusService;
        this.offlineRepoTreeService = offlineRepoTreeService;
        this.offlineBranchSummaryService = offlineBranchSummaryService;
        this.operationsExecutionService = operationsExecutionService;
        this.parameterGroupMapper = parameterGroupMapper;
        this.gitSyncConfigService = gitSyncConfigService;
        this.projectGroupMemberMapper = projectGroupMemberMapper;
        this.offlineFlowIndexService = offlineFlowIndexService;
        this.offlineRecentFlowService = offlineRecentFlowService;
    }

    public WorkspaceSummaryResponse getSummary(GroupAccessContext access) {
        return getSummary(access, null);
    }

    public WorkspaceSummaryResponse getSummary(GroupAccessContext access, String requestedBranch) {
        Long groupId = access.groupId();
        String role = access.systemAdmin() ? "SYSTEM_ADMIN" : access.memberRole();
        String normalizedRequest = blankToNull(requestedBranch);

        DataSourceSummary datasources = access.hasPermission(Permission.DATASOURCE_READ)
                ? buildDataSourceSummary(groupId)
                : null;

        OfflineSummary offline = null;
        OperationsSummary operations = null;
        int workingTreeFlowCount = 0;

        if (access.hasPermission(Permission.OFFLINE_READ)) {
            OfflineRepoStatusResponse status = offlineRepoStatusService.getRepoStatus(groupId);
            String workingTreeBranch = blankToNull(status != null ? status.branch() : null);
            List<String> gitBranches = normalizeBranches(offlineBranchSummaryService.listAvailableBranches(groupId));

            String initialBranch = resolveSelectedBranch(normalizedRequest, workingTreeBranch, gitBranches);
            boolean allowSyncedFallback = normalizedRequest == null && !gitBranches.contains(initialBranch);
            operations = buildOperationsSummary(groupId, initialBranch, allowSyncedFallback);

            String selectedBranch = operations.selectedBranch() != null ? operations.selectedBranch() : initialBranch;
            List<String> availableBranches = mergeAvailableBranches(
                    selectedBranch,
                    workingTreeBranch,
                    gitBranches,
                    operations.availableBranches()
            );

            OfflineBuildResult offlineResult = buildOfflineSummary(
                    access,
                    status,
                    workingTreeBranch,
                    selectedBranch,
                    availableBranches
            );
            offline = offlineResult.summary();
            workingTreeFlowCount = offlineResult.workingTreeFlowCount();
        }

        ParameterSummary parameters = access.hasPermission(Permission.PARAMETER_READ)
                ? buildParameterSummary(groupId)
                : null;
        GitSyncSummary gitSync = access.hasPermission(Permission.GROUP_SETTINGS)
                ? buildGitSyncSummary(groupId)
                : null;
        MemberSummary members = access.hasPermission(Permission.MEMBER_READ)
                ? buildMemberSummary(groupId)
                : null;

        boolean onboarding = offline != null
                && offline.flowCount() == 0
                && workingTreeFlowCount == 0
                && (operations == null || !operations.available() || operations.counts().total() == 0);

        return new WorkspaceSummaryResponse(
                groupId,
                access.groupName(),
                role,
                onboarding,
                datasources,
                offline,
                operations,
                parameters,
                gitSync,
                members
        );
    }

    private DataSourceSummary buildDataSourceSummary(Long groupId) {
        List<DataSource> rows = dataSourceMapper.selectList(
                new LambdaQueryWrapper<DataSource>()
                        .eq(DataSource::getGroupId, groupId)
                        .orderByDesc(DataSource::getUpdatedAt)
                        .orderByDesc(DataSource::getId)
        );
        if (rows == null || rows.isEmpty()) {
            return new DataSourceSummary(0, 0, List.of(), List.of());
        }

        int enabledCount = 0;
        Map<String, Integer> typeCounts = new LinkedHashMap<>();
        List<DataSource> enabledFirst = new ArrayList<>(rows.size());
        List<DataSource> others = new ArrayList<>();

        for (DataSource row : rows) {
            if (isEnabledStatus(row.getStatus())) {
                enabledCount++;
                enabledFirst.add(row);
            } else {
                others.add(row);
            }
            String typeKey = normalizeType(row.getType());
            typeCounts.merge(typeKey, 1, Integer::sum);
        }
        enabledFirst.addAll(others);

        List<DataSourceTypeCount> byType = typeCounts.entrySet().stream()
                .map(entry -> new DataSourceTypeCount(entry.getKey(), entry.getValue()))
                .sorted(Comparator
                        .comparingInt(DataSourceTypeCount::count).reversed()
                        .thenComparing(DataSourceTypeCount::type))
                .toList();

        List<DataSourceBrief> items = enabledFirst.stream()
                .limit(MAX_DATASOURCE_ITEMS)
                .map(ds -> new DataSourceBrief(
                        ds.getId(),
                        ds.getName(),
                        normalizeType(ds.getType()),
                        ds.getDescription(),
                        ds.getDatabaseName(),
                        ds.getStatus()
                ))
                .toList();

        return new DataSourceSummary(rows.size(), enabledCount, byType, items);
    }

    private String resolveSelectedBranch(String normalizedRequest,
                                         String workingTreeBranch,
                                         List<String> gitBranches) {
        if (normalizedRequest != null) {
            return normalizedRequest;
        }
        if (gitBranches.contains(DEFAULT_BRANCH)) {
            return DEFAULT_BRANCH;
        }
        if (workingTreeBranch != null) {
            return workingTreeBranch;
        }
        if (!gitBranches.isEmpty()) {
            return gitBranches.getFirst();
        }
        return DEFAULT_BRANCH;
    }

    private List<String> mergeAvailableBranches(String selectedBranch,
                                                String workingTreeBranch,
                                                List<String> gitBranches,
                                                List<String> syncedBranches) {
        Set<String> merged = new LinkedHashSet<>();
        if (gitBranches.contains(DEFAULT_BRANCH)
                || syncedBranches.contains(DEFAULT_BRANCH)
                || DEFAULT_BRANCH.equals(workingTreeBranch)
                || DEFAULT_BRANCH.equals(selectedBranch)) {
            merged.add(DEFAULT_BRANCH);
        }
        if (workingTreeBranch != null) {
            merged.add(workingTreeBranch);
        }
        merged.addAll(syncedBranches);
        gitBranches.stream()
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .forEach(merged::add);
        if (selectedBranch != null) {
            merged.add(selectedBranch);
        }
        return List.copyOf(merged);
    }

    private OfflineBuildResult buildOfflineSummary(GroupAccessContext access,
                                                   OfflineRepoStatusResponse status,
                                                   String workingTreeBranch,
                                                   String selectedBranch,
                                                   List<String> availableBranches) {
        Long groupId = access.groupId();
        Long userId = access.user() != null ? access.user().id() : null;
        Set<String> dirtyFlowPaths = offlineRepoStatusService.listDirtyFlowPaths(groupId);
        WorkingTreeFlowStats workingTreeStats = loadWorkingTreeFlowStats(
                groupId,
                access.groupName(),
                userId,
                dirtyFlowPaths
        );

        int workingTreeFlowCount = workingTreeStats.flowCount();
        int workingTreeScheduledCount = workingTreeStats.scheduledFlowCount();
        List<RecentFlowItem> recentFlows = workingTreeStats.recentFlows();
        boolean repoInitialized = status != null && status.exists() && status.gitInitialized();

        boolean viewingWorkingTree = selectedBranch != null && selectedBranch.equals(workingTreeBranch);
        int flowCount;
        int scheduledFlowCount;
        boolean ahead;
        boolean hasUpstream;
        String headCommitId;
        String headCommitMessage;
        Instant headCommitAt;

        if (viewingWorkingTree || !repoInitialized) {
            flowCount = workingTreeFlowCount;
            scheduledFlowCount = workingTreeScheduledCount;
            ahead = status != null && status.ahead();
            hasUpstream = status != null && status.hasUpstream();
            headCommitId = status != null ? status.headCommitId() : null;
            headCommitMessage = status != null ? status.headCommitMessage() : null;
            headCommitAt = status != null ? status.headCommitAt() : null;
        } else {
            OfflineBranchSummaryService.BranchSnapshotSummary snapshot =
                    offlineBranchSummaryService.summarizeBranch(groupId, selectedBranch);
            boolean snapshotExists = snapshot != null && snapshot.exists();
            flowCount = snapshotExists ? snapshot.flowCount() : 0;
            scheduledFlowCount = snapshotExists ? snapshot.scheduledFlowCount() : 0;
            ahead = snapshotExists && snapshot.ahead();
            hasUpstream = snapshotExists && snapshot.hasUpstream();
            headCommitId = snapshotExists ? snapshot.headCommitId() : null;
            headCommitMessage = snapshotExists ? snapshot.headCommitMessage() : null;
            headCommitAt = snapshotExists ? snapshot.headCommitAt() : null;
        }

        OfflineSummary summary = new OfflineSummary(
                repoInitialized,
                selectedBranch != null ? selectedBranch : workingTreeBranch,
                workingTreeBranch,
                availableBranches,
                status != null && status.dirty(),
                ahead,
                status != null && status.hasRemote(),
                hasUpstream,
                headCommitId,
                headCommitMessage,
                headCommitAt,
                flowCount,
                scheduledFlowCount,
                dirtyFlowPaths.size(),
                recentFlows
        );
        return new OfflineBuildResult(summary, workingTreeFlowCount);
    }

    private record OfflineBuildResult(OfflineSummary summary, int workingTreeFlowCount) {
    }

    private record WorkingTreeFlowStats(int flowCount, int scheduledFlowCount, List<RecentFlowItem> recentFlows) {
    }

    private WorkingTreeFlowStats loadWorkingTreeFlowStats(Long groupId,
                                                          String groupName,
                                                          Long userId,
                                                          Set<String> dirtyFlowPaths) {
        if (offlineFlowIndexService != null && offlineFlowIndexService.isEnabled()) {
            return loadWorkingTreeFlowStatsFromIndex(groupId, userId, dirtyFlowPaths);
        }
        OfflineRepoTreeResponse tree = offlineRepoTreeService.getRepoTree(groupId, groupName, userId);
        Map<String, OfflineRepoTreeNodeResponse> flowsByPath = new LinkedHashMap<>();
        collectFlowNodes(tree != null ? tree.root() : null, flowsByPath);

        int workingTreeFlowCount = flowsByPath.size();
        int workingTreeScheduledCount = (int) flowsByPath.values().stream()
                .filter(node -> "ENABLED".equalsIgnoreCase(node.scheduleState()))
                .count();
        List<RecentFlowItem> recentFlows = buildRecentFlows(tree, flowsByPath, dirtyFlowPaths);
        return new WorkingTreeFlowStats(workingTreeFlowCount, workingTreeScheduledCount, recentFlows);
    }

    private WorkingTreeFlowStats loadWorkingTreeFlowStatsFromIndex(Long groupId,
                                                                   Long userId,
                                                                   Set<String> dirtyFlowPaths) {
        Map<String, WbOfflineFlowIndex> indexedFlows = offlineFlowIndexService.listGroupFlowMap(groupId);
        if (indexedFlows == null || indexedFlows.isEmpty()) {
            return new WorkingTreeFlowStats(0, 0, List.of());
        }

        int flowCount = indexedFlows.size();
        int scheduledFlowCount = 0;
        for (WbOfflineFlowIndex row : indexedFlows.values()) {
            if (OfflineFlowIndexService.PARSE_STATUS_OK.equals(row.getParseStatus())
                    && Boolean.TRUE.equals(row.getHasSchedule())
                    && Boolean.TRUE.equals(row.getScheduleEnabled())) {
                scheduledFlowCount++;
            }
        }

        List<String> recentFlowPaths = offlineRecentFlowService != null
                ? offlineRecentFlowService.listRecentFlowPaths(userId, groupId)
                : List.of();
        List<RecentFlowItem> recentFlows = buildRecentFlowsFromIndex(indexedFlows, recentFlowPaths, dirtyFlowPaths);
        return new WorkingTreeFlowStats(flowCount, scheduledFlowCount, recentFlows);
    }

    private List<RecentFlowItem> buildRecentFlowsFromIndex(Map<String, WbOfflineFlowIndex> indexedFlows,
                                                            List<String> recentFlowPaths,
                                                            Set<String> dirtyFlowPaths) {
        if (indexedFlows.isEmpty()) {
            return List.of();
        }
        Set<String> selectedPaths = new LinkedHashSet<>();
        if (recentFlowPaths != null) {
            for (String rawPath : recentFlowPaths) {
                String normalizedPath = normalizeFlowPath(rawPath);
                if (!normalizedPath.isEmpty() && indexedFlows.containsKey(normalizedPath)) {
                    selectedPaths.add(normalizedPath);
                }
                if (selectedPaths.size() >= MAX_RECENT_FLOWS) {
                    break;
                }
            }
        }
        if (selectedPaths.size() < MAX_RECENT_FLOWS) {
            indexedFlows.keySet().stream()
                    .sorted(Comparator
                            .comparing(this::resolveFlowDisplayName, String.CASE_INSENSITIVE_ORDER)
                            .thenComparing(String.CASE_INSENSITIVE_ORDER))
                    .forEach(path -> {
                        if (selectedPaths.size() < MAX_RECENT_FLOWS) {
                            selectedPaths.add(path);
                        }
                    });
        }

        List<RecentFlowItem> result = new ArrayList<>(selectedPaths.size());
        for (String path : selectedPaths) {
            WbOfflineFlowIndex row = indexedFlows.get(path);
            if (row == null) {
                continue;
            }
            boolean parseOk = OfflineFlowIndexService.PARSE_STATUS_OK.equals(row.getParseStatus());
            String scheduleState = !parseOk || !Boolean.TRUE.equals(row.getHasSchedule())
                    ? "NONE"
                    : Boolean.TRUE.equals(row.getScheduleEnabled()) ? "ENABLED" : "DISABLED";
            String schedulePeriod = parseOk ? row.getSchedulePeriod() : null;
            result.add(new RecentFlowItem(
                    path,
                    resolveFlowDisplayName(path),
                    extractFlowDirectory(path),
                    scheduleState,
                    schedulePeriod,
                    dirtyFlowPaths.contains(path)
            ));
        }
        return List.copyOf(result);
    }

    private List<RecentFlowItem> buildRecentFlows(OfflineRepoTreeResponse tree,
                                                  Map<String, OfflineRepoTreeNodeResponse> flowsByPath,
                                                  Set<String> dirtyFlowPaths) {
        if (flowsByPath.isEmpty()) {
            return List.of();
        }
        Set<String> selectedPaths = new LinkedHashSet<>();
        if (tree != null && tree.recentFlowPaths() != null) {
            for (String path : tree.recentFlowPaths()) {
                if (flowsByPath.containsKey(path)) {
                    selectedPaths.add(path);
                }
                if (selectedPaths.size() >= MAX_RECENT_FLOWS) {
                    break;
                }
            }
        }
        if (selectedPaths.size() < MAX_RECENT_FLOWS) {
            flowsByPath.values().stream()
                    .sorted(Comparator.comparing(
                            OfflineRepoTreeNodeResponse::name,
                            Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER)))
                    .map(OfflineRepoTreeNodeResponse::path)
                    .forEach(path -> {
                        if (selectedPaths.size() < MAX_RECENT_FLOWS) {
                            selectedPaths.add(path);
                        }
                    });
        }

        List<RecentFlowItem> result = new ArrayList<>(selectedPaths.size());
        for (String path : selectedPaths) {
            OfflineRepoTreeNodeResponse node = flowsByPath.get(path);
            if (node == null) {
                continue;
            }
            result.add(new RecentFlowItem(
                    path,
                    node.name(),
                    extractFlowDirectory(path),
                    node.scheduleState(),
                    node.schedulePeriod(),
                    dirtyFlowPaths.contains(path)
            ));
        }
        return List.copyOf(result);
    }

    private OperationsSummary buildOperationsSummary(Long groupId, String selectedBranch, boolean allowSyncedFallback) {
        Instant to = Instant.now();
        Instant from = to.minus(Duration.ofHours(24));

        try {
            OperationsExecutionListResponse response = operationsExecutionService.listExecutions(
                    groupId,
                    new OperationsExecutionQuery(selectedBranch, null, null, from, to, 1, OPERATIONS_FETCH_SIZE)
            );
            List<String> syncedBranches = normalizeBranches(
                    response != null ? response.branches() : null
            );

            String effectiveBranch = selectedBranch;
            boolean branchSynced = effectiveBranch != null && syncedBranches.contains(effectiveBranch);
            if (allowSyncedFallback && !branchSynced && !syncedBranches.isEmpty()) {
                effectiveBranch = syncedBranches.contains(DEFAULT_BRANCH)
                        ? DEFAULT_BRANCH
                        : syncedBranches.getFirst();
                branchSynced = true;
                response = operationsExecutionService.listExecutions(
                        groupId,
                        new OperationsExecutionQuery(effectiveBranch, null, null, from, to, 1, OPERATIONS_FETCH_SIZE)
                );
            }

            List<OperationsExecutionListItem> executions = response != null && response.executions() != null
                    ? response.executions()
                    : List.of();
            OperationsExecutionStatusCounts counts = response != null && response.statusCounts() != null
                    ? response.statusCounts()
                    : new OperationsExecutionStatusCounts(0, 0, 0, 0, 0);

            List<OperationsExecutionListItem> attentionExecutions = executions.stream()
                    .filter(item -> isAttentionStatus(item.status()))
                    .sorted(Comparator
                            .comparingInt((OperationsExecutionListItem item) -> attentionPriority(item.status()))
                            .thenComparing(this::effectiveExecutionTime, Comparator.nullsLast(Comparator.reverseOrder())))
                    .limit(MAX_EXECUTIONS)
                    .toList();

            List<OperationsExecutionListItem> recentExecutions = executions.stream()
                    .limit(MAX_EXECUTIONS)
                    .toList();

            return new OperationsSummary(
                    true,
                    null,
                    effectiveBranch,
                    branchSynced,
                    syncedBranches,
                    counts,
                    attentionExecutions,
                    recentExecutions
            );
        } catch (RuntimeException ex) {
            log.warn("加载项目组 {} 近 24h 执行摘要失败，已降级返回: {}", groupId, ex.getMessage());
            return new OperationsSummary(
                    false,
                    "无法获取 Kestra 执行状态，请检查调度服务连接后重试",
                    selectedBranch,
                    false,
                    List.of(),
                    new OperationsExecutionStatusCounts(0, 0, 0, 0, 0),
                    List.of(),
                    List.of()
            );
        }
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private List<String> normalizeBranches(List<String> branches) {
        if (branches == null || branches.isEmpty()) {
            return List.of();
        }
        Set<String> deduplicated = new LinkedHashSet<>();
        for (String branch : branches) {
            if (branch != null && !branch.isBlank()) {
                deduplicated.add(branch.trim());
            }
        }
        return List.copyOf(deduplicated);
    }

    private ParameterSummary buildParameterSummary(Long groupId) {
        Long count = parameterGroupMapper.selectCount(
                new LambdaQueryWrapper<WbParameterGroup>()
                        .eq(WbParameterGroup::getGroupId, groupId)
                        .eq(WbParameterGroup::getStatus, "ACTIVE")
        );
        return new ParameterSummary(count == null ? 0 : count.intValue());
    }

    private GitSyncSummary buildGitSyncSummary(Long groupId) {
        try {
            GitSyncConfigListResponse listResponse = gitSyncConfigService.list(groupId);
            List<GitSyncConfigResponse> configs = listResponse != null && listResponse.configs() != null
                    ? listResponse.configs()
                    : List.of();
            if (configs.isEmpty()) {
                return new GitSyncSummary(false, 0, null, null, null, null);
            }
            int enabledCount = (int) configs.stream().filter(GitSyncConfigResponse::enabled).count();
            GitSyncConfigResponse latest = configs.stream()
                    .filter(cfg -> cfg.lastSyncAt() != null)
                    .max(Comparator.comparing(GitSyncConfigResponse::lastSyncAt))
                    .orElseGet(() -> configs.stream()
                            .filter(GitSyncConfigResponse::enabled)
                            .findFirst()
                            .orElse(configs.getFirst()));

            return new GitSyncSummary(
                    true,
                    enabledCount,
                    latest.branch(),
                    latest.lastSyncStatus(),
                    latest.lastSyncAt(),
                    latest.lastSyncMessage()
            );
        } catch (RuntimeException ex) {
            log.warn("加载项目组 {} Git 同步摘要失败: {}", groupId, ex.getMessage());
            return new GitSyncSummary(false, 0, null, "ERROR", null, "读取同步配置失败");
        }
    }

    private MemberSummary buildMemberSummary(Long groupId) {
        Long count = projectGroupMemberMapper.selectCount(
                new LambdaQueryWrapper<WbProjectGroupMember>()
                        .eq(WbProjectGroupMember::getGroupId, groupId)
        );
        return new MemberSummary(count == null ? 0 : count.intValue());
    }

    private void collectFlowNodes(OfflineRepoTreeNodeResponse node,
                                  Map<String, OfflineRepoTreeNodeResponse> out) {
        if (node == null) {
            return;
        }
        if ("FLOW".equals(node.kind()) && node.path() != null && !node.path().isBlank()) {
            out.put(node.path(), node);
        }
        if (node.children() != null) {
            for (OfflineRepoTreeNodeResponse child : node.children()) {
                collectFlowNodes(child, out);
            }
        }
    }

    private String extractFlowDirectory(String flowPath) {
        if (flowPath == null || flowPath.isBlank()) {
            return "_flows/";
        }
        String normalized = flowPath.replace('\\', '/');
        String[] segments = normalized.split("/");
        // Expected: _flows/<subfolders>/<flowName>/flow.yaml -> show _flows/<subfolders>/
        if (segments.length >= 3 && "flow.yaml".equals(segments[segments.length - 1])) {
            StringBuilder dir = new StringBuilder();
            for (int i = 0; i < segments.length - 2; i++) {
                dir.append(segments[i]).append('/');
            }
            return dir.length() > 0 ? dir.toString() : "_flows/";
        }
        int lastSlash = normalized.lastIndexOf('/');
        return lastSlash >= 0 ? normalized.substring(0, lastSlash + 1) : "_flows/";
    }

    private String normalizeFlowPath(String path) {
        if (path == null) {
            return "";
        }
        return path.trim().replace('\\', '/').replaceAll("^/+", "");
    }

    private String resolveFlowDisplayName(String flowPath) {
        String normalized = normalizeFlowPath(flowPath);
        if (normalized.isEmpty()) {
            return "";
        }
        String[] segments = normalized.split("/");
        if (segments.length >= 2 && "flow.yaml".equals(segments[segments.length - 1])) {
            String parentName = segments[segments.length - 2];
            if (!parentName.isBlank() && !"_flows".equals(parentName)) {
                return parentName;
            }
            return "flow";
        }
        String fileName = segments[segments.length - 1];
        int dotIndex = fileName.lastIndexOf('.');
        return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
    }

    private boolean isEnabledStatus(String status) {
        return status != null && "ENABLED".equalsIgnoreCase(status.trim());
    }

    private String normalizeType(String type) {
        return type == null || type.isBlank() ? "UNKNOWN" : type.trim().toUpperCase(Locale.ROOT);
    }

    private boolean isAttentionStatus(String status) {
        return status != null && ATTENTION_STATUSES.contains(status.trim().toUpperCase(Locale.ROOT));
    }

    private int attentionPriority(String status) {
        return status != null && "FAILED".equalsIgnoreCase(status.trim()) ? 0 : 1;
    }

    private Instant effectiveExecutionTime(OperationsExecutionListItem item) {
        if (item.startDate() != null) {
            return item.startDate();
        }
        if (item.createdAt() != null) {
            return item.createdAt();
        }
        return item.plannedAt();
    }
}
