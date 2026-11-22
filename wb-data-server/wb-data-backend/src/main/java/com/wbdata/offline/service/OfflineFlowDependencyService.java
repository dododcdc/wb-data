package com.wbdata.offline.service;

import com.wbdata.offline.repo.service.RepoLockManager;

import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.schedule.dto.OfflineDependencyCandidateResponse;
import com.wbdata.offline.schedule.dto.OfflineDependencyConfigResponse;
import com.wbdata.offline.schedule.dto.OfflineDependencyItemResponse;
import com.wbdata.offline.schedule.dto.OfflineDependentItemResponse;
import com.wbdata.offline.dto.OfflineFlowContentResponse;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import com.wbdata.offline.schedule.dto.UpdateOfflineDependenciesRequest;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.schedule.HourlyCronHours;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

@Service
public class OfflineFlowDependencyService {

    static final int MAX_DEPENDENCIES = 20;

    private final OfflineProperties offlineProperties;
    private final OfflineFlowContentService offlineFlowContentService;
    private final RepoLockManager repoLockManager;
    private final PermissionService permissionService;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public OfflineFlowDependencyService(OfflineProperties offlineProperties,
                                        OfflineFlowContentService offlineFlowContentService,
                                        RepoLockManager repoLockManager,
                                        PermissionService permissionService) {
        this.offlineProperties = offlineProperties;
        this.offlineFlowContentService = offlineFlowContentService;
        this.repoLockManager = repoLockManager;
        this.permissionService = permissionService;
    }

    public OfflineDependencyConfigResponse getConfig(Long groupId, String path,
                                                     List<ProjectGroupContextItem> accessibleGroups) {
        OfflineFlowContentResponse flow = offlineFlowContentService.getFlowContent(groupId, path);
        Map<OfflineFlowDependencyRef, FlowDependencySnapshot> snapshots = scanAccessible(accessibleGroups);
        Map<Long, String> groupNames = groupNames(accessibleGroups);
        List<OfflineDependencyItemResponse> items = yamlSupport.readDependencies(flow.content()).stream()
                .filter(ref -> groupNames.containsKey(ref.groupId()))
                .map(ref -> {
                    FlowDependencySnapshot upstream = snapshots.get(ref);
                    return new OfflineDependencyItemResponse(ref.groupId(), groupNames.get(ref.groupId()),
                            ref.flowId(), upstream == null ? null : upstream.path(),
                            upstream == null ? null : upstream.period(),
                            upstream == null ? null : upstream.crossGroupDependency(),
                            upstream == null ? null : upstream.cron(),
                            upstream == null ? null : upstream.timezone(),
                            upstream != null && upstream.enabled());
                }).toList();
        return new OfflineDependencyConfigResponse(groupId, path, items,
                yamlSupport.readFailurePolicy(flow.content()), yamlSupport.readCrossGroupDependency(flow.content()),
                flow.contentHash(), flow.fileUpdatedAt());
    }

    public <T> T withDependencyGraphLock(Supplier<T> action) {
        return repoLockManager.withGraphLock(action);
    }

    /** Must be called before taking any group lock; validates rollback safety and collects soft upstream warnings. */
    public <T> T rollbackDocument(Long groupId,
                                  String path,
                                  List<ProjectGroupContextItem> accessibleGroups,
                                  Function<OfflineFlowDocumentService.DependencyRollbackValidator, T> rollbackAction) {
        return withDependencyGraphLock(() -> {
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            Path relative = validateFlowPath(path);
            Path flowFile = repoPath.resolve(relative);
            OfflineFlowDependencyRef currentSelf = Files.exists(flowFile)
                    ? new OfflineFlowDependencyRef(
                            groupId,
                            yamlSupport.parseIdentity(offlineFlowContentService.getFlowContent(groupId, path).content()).flowId())
                    : null;
            var snapshots = scanAll();
            OfflineFlowDocumentService.DependencyRollbackValidator validator = targetFlowContent ->
                    validateRollbackConfig(groupId, relative, currentSelf, targetFlowContent, accessibleGroups, snapshots);
            return rollbackAction.apply(validator);
        });
    }

    /** Must be called before taking any group lock; the callback keeps validation and all writes together. */
    public <T> T saveDocument(SaveOfflineFlowDocumentRequest request,
                              List<ProjectGroupContextItem> accessibleGroups, Supplier<T> save) {
        return withDependencyGraphLock(() -> {
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            Path relative = validateFlowPath(request.path());
            Path flowFile = repoPath.resolve(relative);
            boolean existsOnDisk = Files.exists(flowFile);
            String source = existsOnDisk
                    ? offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content()
                    : yamlSupport.buildEmptyFlowYaml(relative.getParent().getFileName().toString(), "pg-" + request.groupId());
            // Validate the requested schedule, not the old persisted frequency, without creating a stub file.
            String finalSource = yamlSupport.applySchedule(source, request.schedule());
            OfflineFlowDependencySettings existingSettings = yamlSupport.readDependencyConfig(source);
            OfflineFlowYamlSupport.ScheduleData existingSchedule = yamlSupport.readSchedule(source);
            OfflineFlowDependencySettings settings = request.dependencyConfig() == null
                    ? existingSettings : request.dependencyConfig();
            OfflineFlowYamlSupport.ScheduleData targetSchedule = yamlSupport.readSchedule(finalSource);
            var self = new OfflineFlowDependencyRef(request.groupId(), yamlSupport.parseIdentity(source).flowId());
            var snapshots = scanAll();
            var existing = snapshots.get(self);
            if (existing != null && !Path.of(existing.path()).normalize().equals(relative)) {
                throw invalid("任务标识已存在，请使用其他任务名称");
            }
            boolean hourlyHoursChanged = existingSchedule != null
                    && targetSchedule != null
                    && existingSchedule.period() == OfflineSchedulePeriod.HOURLY
                    && targetSchedule.period() == OfflineSchedulePeriod.HOURLY
                    && !Objects.equals(
                            HourlyCronHours.parseHourlyCronHours(existingSchedule.cron()),
                            HourlyCronHours.parseHourlyCronHours(targetSchedule.cron()));
            boolean validateUpstreamStrictly = !existsOnDisk
                    || !Objects.equals(existingSettings.dependencies(), settings.dependencies())
                    || !Objects.equals(
                            existingSchedule == null ? null : existingSchedule.period(),
                            targetSchedule == null ? null : targetSchedule.period())
                    || hourlyHoursChanged;
            validateConfig(self, targetSchedule, settings, accessibleGroups, snapshots, validateUpstreamStrictly);
            return save.get();
        });
    }

    public OfflineDependencyConfigResponse updateConfig(UpdateOfflineDependenciesRequest request,
                                                        List<ProjectGroupContextItem> accessibleGroups) {
        return withDependencyGraphLock(() -> {
            OfflineFlowContentResponse current = offlineFlowContentService.getFlowContent(request.groupId(), request.path());
            OfflineFlowDependencySettings settings = new OfflineFlowDependencySettings(
                    request.dependencies(), request.failurePolicy(), request.crossGroupDependency());
            validateConfig(new OfflineFlowDependencyRef(request.groupId(), yamlSupport.parseIdentity(current.content()).flowId()),
                    yamlSupport.readSchedule(current.content()), settings, accessibleGroups, scanAll(), true);
            String updated = yamlSupport.applyDependencyConfig(current.content(), settings.dependencies(),
                    settings.failurePolicy(), settings.crossGroupDependency());
            offlineFlowContentService.saveFlowContent(new SaveOfflineFlowRequest(request.groupId(), request.path(),
                    updated, request.contentHash(), request.fileUpdatedAt()));
            return getConfig(request.groupId(), request.path(), accessibleGroups);
        });
    }

    private Path validateFlowPath(String path) {
        if (path == null || path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法");
        }
        Path relative = Path.of(path).normalize();
        if (relative.isAbsolute() || !relative.startsWith("_flows") || relative.getNameCount() < 3
                || !"flow.yaml".equals(relative.getFileName().toString())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法");
        }
        return relative;
    }

    private List<String> validateRollbackConfig(Long groupId,
                                                Path relative,
                                                OfflineFlowDependencyRef currentSelf,
                                                String targetFlowContent,
                                                List<ProjectGroupContextItem> accessibleGroups,
                                                Map<OfflineFlowDependencyRef, FlowDependencySnapshot> snapshots) {
        OfflineFlowDependencyRef self = new OfflineFlowDependencyRef(
                groupId, yamlSupport.parseIdentity(targetFlowContent).flowId());
        FlowDependencySnapshot existing = snapshots.get(self);
        if (existing != null && !Path.of(existing.path()).normalize().equals(relative)) {
            throw invalid("任务标识已存在，请使用其他任务名称");
        }
        if (currentSelf != null && !currentSelf.equals(self)) {
            List<FlowDependencySnapshot> dependents = findDependentsIn(snapshots.values(), currentSelf);
            if (!dependents.isEmpty()) {
                throw invalid("存在下游任务依赖，不能修改任务标识: "
                        + formatDependents(dependents, accessibleGroups) + "，请先解除依赖");
            }
        }
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(targetFlowContent);
        OfflineFlowDependencySettings settings = yamlSupport.readDependencyConfig(targetFlowContent);
        validateBasicRefs(self, settings.dependencies());
        List<String> upstreamIssues = collectUpstreamIssues(
                self, schedule, settings.dependencies(), accessibleGroups, snapshots);
        validateCycleAndDownstreams(self, schedule, settings, accessibleGroups, snapshots);
        return upstreamIssues;
    }

    private void validateConfig(OfflineFlowDependencyRef self, OfflineFlowYamlSupport.ScheduleData schedule,
                                OfflineFlowDependencySettings settings, List<ProjectGroupContextItem> accessibleGroups,
                                Map<OfflineFlowDependencyRef, FlowDependencySnapshot> snapshots,
                                boolean validateUpstreamStrictly) {
        validateBasicRefs(self, settings.dependencies());
        if (validateUpstreamStrictly) {
            List<String> upstreamIssues = collectUpstreamIssues(
                    self, schedule, settings.dependencies(), accessibleGroups, snapshots);
            if (!upstreamIssues.isEmpty()) {
                throw invalid(upstreamIssues.getFirst());
            }
        }
        validateCycleAndDownstreams(self, schedule, settings, accessibleGroups, snapshots);
    }

    private void validateBasicRefs(OfflineFlowDependencyRef self, List<OfflineFlowDependencyRef> refs) {
        if (refs.size() > MAX_DEPENDENCIES) {
            throw invalid("前置任务数量超过上限 " + MAX_DEPENDENCIES);
        }
        if (refs.stream().anyMatch(ref -> ref == null || ref.groupId() == null || ref.groupId() <= 0
                || ref.flowId() == null || ref.flowId().isBlank())) {
            throw invalid("前置任务引用不合法");
        }
        if (new LinkedHashSet<>(refs).size() != refs.size()) {
            throw invalid("前置任务存在重复");
        }
        if (refs.contains(self)) {
            throw invalid("任务不能依赖自身");
        }
    }

    private void validateCycleAndDownstreams(OfflineFlowDependencyRef self,
                                             OfflineFlowYamlSupport.ScheduleData schedule,
                                             OfflineFlowDependencySettings settings,
                                             List<ProjectGroupContextItem> accessibleGroups,
                                             Map<OfflineFlowDependencyRef, FlowDependencySnapshot> snapshots) {
        if (createsCycle(snapshots, self, settings.dependencies())) {
            throw invalid("依赖配置会形成循环，请调整前置任务");
        }
        List<FlowDependencySnapshot> dependents = findDependentsIn(snapshots.values(), self);
        if (settings.crossGroupDependency() == OfflineCrossGroupDependency.DENY
                && dependents.stream().anyMatch(item -> !item.groupId().equals(self.groupId()))) {
            throw invalid("存在跨项目组下游依赖，不能关闭跨项目组依赖开关，请先解除相关依赖");
        }
        List<FlowDependencySnapshot> incompatible = dependents.stream()
                .filter(item -> schedule == null || !standard(schedule.period()) || item.period() != schedule.period())
                .toList();
        if (!incompatible.isEmpty()) {
            throw invalid("存在下游任务依赖，不能修改调度频率: "
                    + formatDependents(incompatible, accessibleGroups) + "，请先解除依赖");
        }
        if (schedule != null && schedule.period() == OfflineSchedulePeriod.HOURLY) {
            List<FlowDependencySnapshot> incompatibleHours = dependents.stream()
                    .filter(item -> item.period() == OfflineSchedulePeriod.HOURLY)
                    .filter(item -> HourlyCronHours.parseHourlyCronHours(schedule.cron()).isEmpty()
                            || HourlyCronHours.missingHours(item.cron(), schedule.cron())
                                    .map(missing -> !missing.isEmpty())
                                    .orElse(true))
                    .toList();
            if (!incompatibleHours.isEmpty()) {
                throw invalid("存在下游任务依赖的调度小时超出当前配置: "
                        + formatDependents(incompatibleHours, accessibleGroups) + "，请先调整下游或解除依赖");
            }
        }
    }

    private List<String> collectUpstreamIssues(OfflineFlowDependencyRef self,
                                               OfflineFlowYamlSupport.ScheduleData schedule,
                                               List<OfflineFlowDependencyRef> refs,
                                               List<ProjectGroupContextItem> accessibleGroups,
                                               Map<OfflineFlowDependencyRef, FlowDependencySnapshot> snapshots) {
        List<String> issues = new ArrayList<>();
        boolean selfHasStandardPeriod = standard(schedule == null ? null : schedule.period());
        if (!refs.isEmpty() && !selfHasStandardPeriod) {
            issues.add("本任务需先配置标准调度频率，才能配置前置依赖");
        }
        Set<Long> accessibleIds = groupNames(accessibleGroups).keySet();
        for (OfflineFlowDependencyRef ref : refs) {
            if (!accessibleIds.contains(ref.groupId())) {
                issues.add("无权引用前置任务，请检查项目组访问权限");
                continue;
            }
            FlowDependencySnapshot upstream = snapshots.get(ref);
            if (upstream == null) {
                issues.add("前置任务不存在: " + ref.flowId());
                continue;
            }
            if (!upstream.hasSchedule() || !standard(upstream.period())) {
                issues.add("前置任务 " + ref.flowId() + " 未配置标准调度频率，无法依赖");
                continue;
            }
            if (selfHasStandardPeriod && upstream.period() != schedule.period()) {
                issues.add("仅支持相同调度频率的任务依赖: " + ref.flowId());
                continue;
            }
            if (selfHasStandardPeriod && schedule.period() == OfflineSchedulePeriod.HOURLY) {
                if (HourlyCronHours.parseHourlyCronHours(schedule.cron()).isEmpty()) {
                    issues.add("本任务的小时调度配置不合法");
                    continue;
                }
                if (HourlyCronHours.parseHourlyCronHours(upstream.cron()).isEmpty()) {
                    issues.add("前置任务 " + ref.flowId() + " 的小时调度配置不合法，无法依赖");
                    continue;
                }
                List<Integer> missingHours = HourlyCronHours.missingHours(schedule.cron(), upstream.cron()).orElse(List.of());
                if (!missingHours.isEmpty()) {
                    issues.add("前置任务 " + ref.flowId() + " 的调度小时未覆盖本任务（缺少 "
                            + HourlyCronHours.formatHours(missingHours) + "）");
                    continue;
                }
            }
            if (!ref.groupId().equals(self.groupId())
                    && upstream.crossGroupDependency() == OfflineCrossGroupDependency.DENY) {
                issues.add("前置任务 " + ref.flowId() + " 不允许跨项目组依赖");
            }
        }
        return List.copyOf(issues);
    }

    private boolean standard(OfflineSchedulePeriod period) {
        return period != null && period != OfflineSchedulePeriod.CUSTOM;
    }

    public List<OfflineDependencyCandidateResponse> searchCandidates(Long groupId, String path, String keyword,
                                                                     List<ProjectGroupContextItem> accessibleGroups) {
        String selfFlowId = resolveCandidateSelfId(groupId, path);
        Map<Long, String> groupNames = groupNames(accessibleGroups);
        String normalizedKeyword = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return scanAccessible(accessibleGroups).values().stream()
                .filter(snapshot -> !(snapshot.groupId().equals(groupId) && snapshot.flowId().equals(selfFlowId)))
                .filter(snapshot -> normalizedKeyword.isEmpty()
                        || snapshot.flowId().toLowerCase(Locale.ROOT).contains(normalizedKeyword)
                        || snapshot.path().toLowerCase(Locale.ROOT).contains(normalizedKeyword)
                        || groupNames.getOrDefault(snapshot.groupId(), "").toLowerCase(Locale.ROOT).contains(normalizedKeyword))
                .sorted(Comparator.comparing((FlowDependencySnapshot snapshot) -> groupNames.getOrDefault(snapshot.groupId(), ""),
                                String.CASE_INSENSITIVE_ORDER)
                        .thenComparing(FlowDependencySnapshot::flowId, String.CASE_INSENSITIVE_ORDER))
                .map(snapshot -> new OfflineDependencyCandidateResponse(snapshot.groupId(), groupNames.get(snapshot.groupId()),
                        snapshot.flowId(), snapshot.path(), snapshot.hasSchedule(), snapshot.period(), snapshot.crossGroupDependency(),
                        snapshot.cron(), snapshot.timezone(), snapshot.enabled()))
                .toList();
    }

    public List<OfflineDependentItemResponse> findDependents(Long groupId, String path,
                                                             List<ProjectGroupContextItem> accessibleGroups) {
        OfflineFlowDependencyRef self = resolveSelfRef(groupId, path);
        Map<Long, String> groupNames = groupNames(accessibleGroups);
        return findDependentsIn(scanAccessible(accessibleGroups).values(), self).stream()
                .map(item -> new OfflineDependentItemResponse(item.groupId(), groupNames.get(item.groupId()),
                        item.flowId(), item.path(), item.period(), item.cron()))
                .toList();
    }

    public void assertDeletionAllowed(Long groupId, String path, List<ProjectGroupContextItem> accessibleGroups) {
        withDependencyGraphLock(() -> {
            List<FlowDependencySnapshot> dependents = findDependentsIn(scanAll().values(), resolveSelfRef(groupId, path));
            if (!dependents.isEmpty()) {
                throw invalid("存在下游任务依赖，无法删除: " + formatDependents(dependents, accessibleGroups) + "，请先解除依赖");
            }
            return null;
        });
    }

    public void assertPeriodChangeAllowed(Long groupId, String path, OfflineSchedulePeriod newPeriod,
                                          List<ProjectGroupContextItem> accessibleGroups) {
        assertScheduleChangeAllowed(groupId, path, newPeriod, null, accessibleGroups);
    }

    public void assertScheduleChangeAllowed(Long groupId, String path, OfflineSchedulePeriod newPeriod, String newCron,
                                            List<ProjectGroupContextItem> accessibleGroups) {
        withDependencyGraphLock(() -> {
            OfflineFlowContentResponse flow = offlineFlowContentService.getFlowContent(groupId, path);
            OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(flow.content());
            String targetCron = newCron != null ? newCron : (schedule == null ? "" : schedule.cron());
            var proposed = new OfflineFlowYamlSupport.ScheduleData("schedule", targetCron,
                    schedule == null ? null : schedule.timezone(), schedule != null && schedule.enabled(), newPeriod);
            validateConfig(new OfflineFlowDependencyRef(groupId, yamlSupport.parseIdentity(flow.content()).flowId()),
                    proposed, yamlSupport.readDependencyConfig(flow.content()), accessibleGroups, scanAll(), true);
            return null;
        });
    }

    private String resolveCandidateSelfId(Long groupId, String path) {
        try {
            return resolveSelfRef(groupId, path).flowId();
        } catch (ResponseStatusException ex) {
            if (ex.getStatusCode() != HttpStatus.NOT_FOUND) {
                throw ex;
            }
            Path relative = Path.of(path).normalize();
            if (!relative.startsWith("_flows") || relative.getNameCount() < 3) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法");
            }
            return relative.getParent().getFileName().toString();
        }
    }

    private OfflineFlowDependencyRef resolveSelfRef(Long groupId, String path) {
        OfflineFlowContentResponse flow = offlineFlowContentService.getFlowContent(groupId, path);
        return new OfflineFlowDependencyRef(groupId, yamlSupport.parseIdentity(flow.content()).flowId());
    }

    private List<FlowDependencySnapshot> findDependentsIn(java.util.Collection<FlowDependencySnapshot> snapshots,
                                                          OfflineFlowDependencyRef self) {
        return snapshots.stream().filter(snapshot -> snapshot.dependencies().contains(self)).toList();
    }

    private boolean createsCycle(Map<OfflineFlowDependencyRef, FlowDependencySnapshot> snapshots,
                                 OfflineFlowDependencyRef self, List<OfflineFlowDependencyRef> newDependencies) {
        Set<OfflineFlowDependencyRef> visited = new HashSet<>();
        Deque<OfflineFlowDependencyRef> stack = new ArrayDeque<>(newDependencies);
        while (!stack.isEmpty()) {
            OfflineFlowDependencyRef node = stack.pop();
            if (node.equals(self)) {
                return true;
            }
            if (!visited.add(node)) {
                continue;
            }
            FlowDependencySnapshot snapshot = snapshots.get(node);
            if (snapshot != null) {
                stack.addAll(snapshot.dependencies());
            }
        }
        return false;
    }

    private Map<OfflineFlowDependencyRef, FlowDependencySnapshot> scanAccessible(List<ProjectGroupContextItem> accessibleGroups) {
        Map<OfflineFlowDependencyRef, FlowDependencySnapshot> result = new LinkedHashMap<>();
        for (ProjectGroupContextItem group : accessibleGroups) {
            if (!canReadOffline(group)) {
                continue;
            }
            for (FlowDependencySnapshot snapshot : scanGroup(group.id(), false)) {
                result.put(new OfflineFlowDependencyRef(snapshot.groupId(), snapshot.flowId()), snapshot);
            }
        }
        return result;
    }

    // Validation uses every repository, never the caller's visibility-filtered candidate graph.
    // The graph gate also excludes in-process creation of a repository during enumeration.
    private Map<OfflineFlowDependencyRef, FlowDependencySnapshot> scanAll() {
        Map<OfflineFlowDependencyRef, FlowDependencySnapshot> result = new LinkedHashMap<>();
        Path base = Path.of(offlineProperties.getRepoBaseDir());
        if (!Files.exists(base)) {
            return result;
        }
        String prefix = offlineProperties.getRepoDirPrefix();
        try (var directories = Files.list(base)) {
            for (Path directory : directories.filter(Files::isDirectory).toList()) {
                String name = directory.getFileName().toString();
                if (!name.startsWith(prefix)) {
                    continue;
                }
                Long groupId;
                try {
                    groupId = Long.valueOf(name.substring(prefix.length()));
                } catch (NumberFormatException ignored) {
                    continue;
                }
                for (FlowDependencySnapshot snapshot : scanGroup(groupId, true)) {
                    if (result.put(new OfflineFlowDependencyRef(groupId, snapshot.flowId()), snapshot) != null) {
                        throw invalid("任务依赖图存在重复标识，请联系管理员修复");
                    }
                }
            }
            return result;
        } catch (IOException | java.io.UncheckedIOException ex) {
            throw invalid("无法读取完整任务依赖图，请联系管理员检查");
        }
    }

    private List<FlowDependencySnapshot> scanGroup(Long groupId, boolean strict) {
        return repoLockManager.withLock(groupId, () -> {
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            Path flowsDir = repoPath.resolve("_flows");
            if (!Files.isDirectory(flowsDir)) {
                return List.of();
            }
            try (var stream = Files.walk(flowsDir)) {
                List<FlowDependencySnapshot> snapshots = new ArrayList<>();
                for (Path flowFile : stream.filter(candidate -> Files.isRegularFile(candidate)
                        && "flow.yaml".equals(candidate.getFileName().toString())).toList()) {
                    try {
                        String content = Files.readString(flowFile, StandardCharsets.UTF_8);
                        var schedule = yamlSupport.readSchedule(content);
                        snapshots.add(new FlowDependencySnapshot(groupId,
                                repoPath.relativize(flowFile).toString().replace('\\', '/'),
                                yamlSupport.parseIdentity(content).flowId(), schedule != null,
                                schedule == null ? null : schedule.period(), yamlSupport.readDependencies(content),
                                yamlSupport.readCrossGroupDependency(content), schedule == null ? null : schedule.cron(),
                                schedule == null ? null : schedule.timezone(), schedule != null && schedule.enabled()));
                    } catch (RuntimeException | IOException ex) {
                        if (strict) {
                            throw invalid("无法读取完整任务依赖图，请联系管理员检查");
                        }
                    }
                }
                return List.copyOf(snapshots);
            } catch (IOException | java.io.UncheckedIOException ex) {
                throw invalid("无法读取完整任务依赖图，请联系管理员检查");
            }
        });
    }

    private boolean canReadOffline(ProjectGroupContextItem group) {
        return permissionService.resolveProjectPermissions(group.role(), SystemRole.SYSTEM_ADMIN.name().equals(group.role()))
                .contains(Permission.OFFLINE_READ.code());
    }

    private Map<Long, String> groupNames(List<ProjectGroupContextItem> accessibleGroups) {
        return accessibleGroups.stream().filter(this::canReadOffline)
                .collect(Collectors.toMap(ProjectGroupContextItem::id, ProjectGroupContextItem::name, (a, b) -> a));
    }

    private String formatDependents(List<FlowDependencySnapshot> dependents, List<ProjectGroupContextItem> accessibleGroups) {
        Map<Long, String> names = groupNames(accessibleGroups);
        return dependents.stream().map(item -> names.containsKey(item.groupId())
                        ? names.get(item.groupId()) + "/" + item.flowId() : "存在无权查看的下游任务")
                .distinct().collect(Collectors.joining("、"));
    }

    private ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, message);
    }

    record FlowDependencySnapshot(Long groupId, String path, String flowId, boolean hasSchedule,
                                  OfflineSchedulePeriod period, List<OfflineFlowDependencyRef> dependencies,
                                  OfflineCrossGroupDependency crossGroupDependency, String cron, String timezone, boolean enabled) {
    }
}
