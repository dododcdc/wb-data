# Offline Commit Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split offline development commits into “current Flow only” and “repository-wide”, make repository-wide commit and push project-admin only, and align UI wording with actual Git behavior.

**Architecture:** Keep current Flow save/edit behavior in `OfflineWorkbench`, but split commit behavior across two backend endpoints and two UI entry points. Reuse `OfflineFlowDocumentService` to derive the exact file set for a Flow-scoped commit, and use explicit admin gating (`group.settings` / `GROUP_ADMIN`) for repository-wide operations.

**Tech Stack:** React 18 + TypeScript + Vitest, Spring Boot 3 + Java 21 + JUnit 5 + Mockito, git CLI

---

## File Map

- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineRepoController.java`
  - Split current `/repo/commit` behavior into Flow-scoped commit and repo-scoped commit endpoints.
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitPushService.java`
  - Add Flow-scoped commit logic, repo commit logic, repo push admin guard support, and a Flow-scoped dirty check.
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDocumentService.java`
  - Expose current Flow managed file resolution (`flow.yaml`, `.layout.json`, node scripts).
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/CommitRequest.java`
  - Keep this DTO repo-scoped only; update controller usage accordingly.
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/CommitCurrentFlowRequest.java`
  - Request payload for Flow-scoped commit.
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/OfflineFlowCommitStatusResponse.java`
  - Response payload for current Flow dirty status.
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/controller/OfflineRepoControllerPermissionTest.java`
  - Reflection-based tests for controller permission annotations.
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/OfflineFlowDocumentServiceTest.java`
  - Temp-repo tests for Flow managed file resolution.
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/GitPushServiceTest.java`
  - Temp-repo tests for Flow-scoped commit isolation and repo commit behavior.
- Modify: `wb-data-frontend/src/api/offline.ts`
  - Add Flow-scoped commit API, repo commit API, and Flow dirty-status API.
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
  - Split commit UI, add admin gate, drive current Flow commit state from Flow-scoped dirty status.
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx`
  - Cover button visibility, auto-save behavior, and Flow-vs-repo commit request routing.

### Task 1: Split backend commit endpoints and enforce permissions

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/CommitCurrentFlowRequest.java`
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/controller/OfflineRepoControllerPermissionTest.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineRepoController.java`

- [ ] **Step 1: Write the failing controller permission test**

```java
package com.wbdata.offline.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.offline.dto.CommitCurrentFlowRequest;
import com.wbdata.offline.dto.CommitRequest;
import com.wbdata.offline.dto.PushRequest;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineRepoControllerPermissionTest {

    @Test
    void flowCommit_keepsOfflineWritePermission() throws Exception {
        Method method = OfflineRepoController.class.getMethod(
                "commitCurrentFlow",
                AuthContextResponse.class,
                CommitCurrentFlowRequest.class
        );

        RequireGroupAuth auth = (RequireGroupAuth) method.getParameters()[0].getAnnotations()[0];
        assertThat(auth.value()).isEqualTo(Permission.OFFLINE_WRITE);
    }

    @Test
    void repoCommit_andPush_requireGroupSettingsPermission() throws Exception {
        Method repoCommit = OfflineRepoController.class.getMethod(
                "commitRepo",
                AuthContextResponse.class,
                CommitRequest.class
        );
        Method push = OfflineRepoController.class.getMethod(
                "push",
                AuthContextResponse.class,
                PushRequest.class
        );

        RequireGroupAuth repoCommitAuth = (RequireGroupAuth) repoCommit.getParameters()[0].getAnnotations()[0];
        RequireGroupAuth pushAuth = (RequireGroupAuth) push.getParameters()[0].getAnnotations()[0];

        assertThat(repoCommitAuth.value()).isEqualTo(Permission.GROUP_SETTINGS);
        assertThat(pushAuth.value()).isEqualTo(Permission.GROUP_SETTINGS);
    }
}
```

- [ ] **Step 2: Run the backend permission test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=OfflineRepoControllerPermissionTest
```

Expected: FAIL because `commitCurrentFlow` / `commitRepo` do not exist yet and `push` still uses `OFFLINE_WRITE`.

- [ ] **Step 3: Add the Flow-scoped commit request DTO**

```java
package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CommitCurrentFlowRequest(
        @NotNull Long groupId,
        @NotBlank String flowPath,
        String message
) {
}
```

- [ ] **Step 4: Split controller methods and tighten repo-level permissions**

```java
@PostMapping("/repo/commit/flow")
public Result<CommitResponse> commitCurrentFlow(
        @RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
        @Valid @RequestBody CommitCurrentFlowRequest request
) {
    GitPushService.CommitResult result = gitPushService.commitCurrentFlow(
            context.currentGroup().id(),
            request.flowPath(),
            request.message()
    );
    return Result.success(new CommitResponse(result.success(), result.message()));
}

@PostMapping("/repo/commit")
public Result<CommitResponse> commitRepo(
        @RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
        @Valid @RequestBody CommitRequest request
) {
    GitPushService.CommitResult result = gitPushService.commitRepo(
            context.currentGroup().id(),
            request.message()
    );
    return Result.success(new CommitResponse(result.success(), result.message()));
}

@PostMapping("/repo/push")
public Result<PushResponse> push(
        @RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
        @Valid @RequestBody PushRequest request
) {
    GitPushService.PushResult result = gitPushService.push(context.currentGroup().id());
    return Result.success(new PushResponse(result.success(), result.message(), result.remoteUrl(), result.remoteCreated()));
}
```

- [ ] **Step 5: Run the backend permission test to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=OfflineRepoControllerPermissionTest
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineRepoController.java \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/CommitCurrentFlowRequest.java \
  wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/controller/OfflineRepoControllerPermissionTest.java
git commit -m "feat: split offline flow and repo commit endpoints"
```

### Task 2: Expose current Flow managed files from the backend

**Files:**
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDocumentService.java`
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/OfflineFlowDocumentServiceTest.java`

- [ ] **Step 1: Write the failing managed-file resolution test**

```java
package com.wbdata.offline.service;

import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class OfflineFlowDocumentServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void resolveManagedFiles_includesYamlLayoutAndScripts() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService service = new OfflineFlowDocumentService(
                properties,
                new OfflineFlowContentService(properties),
                mock(DataSourceService.class)
        );

        service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "node_1",
                                "echo 1",
                                "SHELL",
                                "scripts/example/node_1.sh",
                                null,
                                null
                        ))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(10, 20))
        ));

        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .containsExactlyInAnyOrder(
                        "_flows/example/flow.yaml",
                        "_flows/example/.layout.json",
                        "scripts/example/node_1.sh"
                );
    }
}
```

- [ ] **Step 2: Run the managed-file resolution test to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=OfflineFlowDocumentServiceTest
```

Expected: FAIL because `resolveManagedFiles` does not exist yet.

- [ ] **Step 3: Add `resolveManagedFiles` to `OfflineFlowDocumentService`**

```java
public List<String> resolveManagedFiles(Long groupId, String path) {
    try {
        DocumentSnapshot snapshot = readSnapshot(groupId, path);
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        LinkedHashSet<String> files = new LinkedHashSet<>();
        files.add(path);

        Path layoutFile = resolveLayoutFile(repoPath, path);
        if (Files.exists(layoutFile)) {
            files.add(repoPath.relativize(layoutFile).toString().replace('\\', '/'));
        }

        for (Path taskFile : snapshot.taskFiles().values()) {
            files.add(repoPath.relativize(taskFile).toString().replace('\\', '/'));
        }
        return List.copyOf(files);
    } catch (IOException ex) {
        throw new IllegalStateException("解析 Flow 关联文件失败", ex);
    }
}
```

- [ ] **Step 4: Run the managed-file resolution test to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=OfflineFlowDocumentServiceTest
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDocumentService.java \
  wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/OfflineFlowDocumentServiceTest.java
git commit -m "feat: expose offline flow managed files"
```

### Task 3: Implement Flow-scoped commit isolation and Flow dirty status

**Files:**
- Create: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/OfflineFlowCommitStatusResponse.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineRepoController.java`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitPushService.java`
- Create: `wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/GitPushServiceTest.java`

- [ ] **Step 1: Write the failing `GitPushService` tests**

```java
package com.wbdata.offline.service;

import com.wbdata.git.service.GitConfigService;
import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

class GitPushServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void commitCurrentFlow_onlyCommitsTrackedFiles() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitPushService service = new GitPushService(properties, Mockito.mock(GitConfigService.class), flowDocumentService);

        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/example/node_1.sh", "echo 1\n");
        write(repo, "scripts/other/node_9.sh", "echo 9\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        write(repo, "scripts/example/node_1.sh", "echo 2\n");
        write(repo, "scripts/other/node_9.sh", "echo 10\n");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", "scripts/example/node_1.sh"));

        service.commitCurrentFlow(1L, "_flows/example/flow.yaml", "flow only");

        assertThat(git(repo, "log", "-1", "--pretty=%s")).isEqualTo("flow only");
        assertThat(git(repo, "status", "--porcelain")).contains("scripts/other/node_9.sh");
    }

    @Test
    void commitCurrentFlow_rejectsOutOfScopeStagedChanges() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitPushService service = new GitPushService(properties, Mockito.mock(GitConfigService.class), flowDocumentService);

        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/example/node_1.sh", "echo 1\n");
        write(repo, "scripts/other/node_9.sh", "echo 9\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        write(repo, "scripts/other/node_9.sh", "echo 10\n");
        git(repo, "add", "scripts/other/node_9.sh");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", "scripts/example/node_1.sh"));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service.commitCurrentFlow(1L, "_flows/example/flow.yaml", "flow only"));

        assertThat(ex.getReason()).contains("已暂存");
    }

    private static void initRepo(Path repo) throws Exception {
        Files.createDirectories(repo);
        git(repo, "init", "-b", "main");
        git(repo, "config", "user.name", "WB Test");
        git(repo, "config", "user.email", "wb@example.com");
    }

    private static void write(Path repo, String relative, String content) throws Exception {
        Path file = repo.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }

    private static String git(Path repo, String... args) throws Exception {
        Process process = new ProcessBuilder(build(repo, args)).redirectErrorStream(true).start();
        int exitCode = process.waitFor();
        String output = new String(process.getInputStream().readAllBytes());
        if (exitCode != 0) {
            throw new IllegalStateException(output);
        }
        return output.trim();
    }

    private static List<String> build(Path repo, String... args) {
        java.util.ArrayList<String> command = new java.util.ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repo.toString());
        command.addAll(List.of(args));
        return command;
    }
}
```

- [ ] **Step 2: Run the `GitPushService` tests to verify they fail**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=GitPushServiceTest
```

Expected: FAIL because `commitCurrentFlow`, Flow-managed-file dependency injection, and staged-scope protection do not exist yet.

- [ ] **Step 3: Implement Flow-scoped commit and Flow dirty status in `GitPushService`**

```java
private final OfflineFlowDocumentService offlineFlowDocumentService;

private String normalizeCommitMessage(String commitMessage) {
    return (commitMessage == null || commitMessage.isBlank())
            ? "update: sync offline changes"
            : commitMessage;
}

public CommitResult commitRepo(Long groupId, String commitMessage) {
    Path repoPath = offlineProperties.resolveRepoPath(groupId);
    ensureRepoExists(repoPath);
    String status = runGit(repoPath, "status", "--porcelain").trim();
    if (status.isEmpty()) {
        return new CommitResult(true, "暂无改动需提交");
    }
    runGit(repoPath, "add", "-A");
    runGit(repoPath, "commit", "-m", normalizeCommitMessage(commitMessage));
    return new CommitResult(true, "仓库版本提交成功");
}

public CommitResult commitCurrentFlow(Long groupId, String flowPath, String commitMessage) {
    Path repoPath = offlineProperties.resolveRepoPath(groupId);
    ensureRepoExists(repoPath);
    List<String> trackedFiles = offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath);

    ensureNoOutOfScopeStagedChanges(repoPath, trackedFiles);

    String scopedStatus = runGitWithPaths(repoPath, List.of("status", "--porcelain"), trackedFiles).trim();
    if (scopedStatus.isEmpty()) {
        return new CommitResult(true, "当前 Flow 暂无改动需提交");
    }

    runGitWithPaths(repoPath, List.of("add", "-A"), trackedFiles);
    runGitWithPaths(repoPath, List.of("commit", "-m", normalizeCommitMessage(commitMessage)), trackedFiles);
    return new CommitResult(true, "当前 Flow 版本提交成功");
}

public boolean hasFlowChanges(Long groupId, String flowPath) {
    Path repoPath = offlineProperties.resolveRepoPath(groupId);
    ensureRepoExists(repoPath);
    List<String> trackedFiles = offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath);
    return !runGitWithPaths(repoPath, List.of("status", "--porcelain"), trackedFiles).isBlank();
}

private void ensureNoOutOfScopeStagedChanges(Path repoPath, List<String> trackedFiles) {
    java.util.Set<String> tracked = new java.util.LinkedHashSet<>(trackedFiles);
    String staged = runGit(repoPath, "diff", "--cached", "--name-only");
    for (String line : staged.lines().filter(s -> !s.isBlank()).toList()) {
        if (!tracked.contains(line.trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "检测到当前 Flow 之外的文件已暂存，请先完成仓库级提交");
        }
    }
}

private String runGitWithPaths(Path repoPath, List<String> args, List<String> trackedFiles) {
    java.util.ArrayList<String> command = new java.util.ArrayList<>(args);
    command.add("--");
    command.addAll(trackedFiles);
    return runGit(repoPath, command.toArray(String[]::new));
}
```

- [ ] **Step 4: Add the Flow dirty-status endpoint and response DTO**

```java
public record OfflineFlowCommitStatusResponse(
        Long groupId,
        String flowPath,
        boolean dirty
) {
}

@GetMapping("/repo/commit/flow/status")
public Result<OfflineFlowCommitStatusResponse> getFlowCommitStatus(
        @RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
        @RequestParam String path
) {
    boolean dirty = gitPushService.hasFlowChanges(context.currentGroup().id(), path);
    return Result.success(new OfflineFlowCommitStatusResponse(context.currentGroup().id(), path, dirty));
}
```

- [ ] **Step 5: Run the backend tests to verify they pass**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=OfflineRepoControllerPermissionTest,OfflineFlowDocumentServiceTest,GitPushServiceTest
```

Expected: PASS with `BUILD SUCCESS`.

- [ ] **Step 6: Commit**

```bash
git add \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/controller/OfflineRepoController.java \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitPushService.java \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/OfflineFlowDocumentService.java \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/dto/OfflineFlowCommitStatusResponse.java \
  wb-data-server/wb-data-backend/src/test/java/com/wbdata/offline/service/GitPushServiceTest.java
git commit -m "feat: add scoped offline flow commits"
```

### Task 4: Update frontend API bindings and offline workbench behavior

**Files:**
- Modify: `wb-data-frontend/src/api/offline.ts`
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`

- [ ] **Step 1: Write the failing frontend tests for admin gating and commit routing**

```tsx
it('hides repo commit and push from developers while keeping current-flow commit available', async () => {
    authState.currentGroup = { id: 1, name: 'Team', role: 'DEVELOPER' };
    authState.permissions = ['offline.write'];

    renderOfflineWorkbench();
    fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
    await screen.findByTestId('flow-canvas');

    expect(screen.getByRole('button', { name: '提交当前 Flow' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '提交仓库改动' })).toBeNull();
    expect(screen.queryByRole('button', { name: '推送' })).toBeNull();
});

it('routes current-flow and repo commit through different API calls', async () => {
    const offlineApi = await import('../../api/offline');
    authState.currentGroup = { id: 1, name: 'Team', role: 'GROUP_ADMIN' };
    authState.permissions = ['offline.write', 'group.settings'];
    vi.mocked(offlineApi.getOfflineFlowCommitStatus).mockResolvedValue({ groupId: 1, flowPath: '_flows/example/flow.yaml', dirty: true });
    vi.mocked(offlineApi.commitOfflineCurrentFlow).mockResolvedValue({ success: true, message: 'ok' });
    vi.mocked(offlineApi.commitOfflineRepo).mockResolvedValue({ success: true, message: 'ok' });

    renderOfflineWorkbench();
    fireEvent.click(await screen.findByRole('button', { name: 'Example Flow' }));
    await screen.findByTestId('flow-canvas');

    fireEvent.click(screen.getByRole('button', { name: '提交当前 Flow' }));
    fireEvent.change(await screen.findByPlaceholderText('例如：Update query conditions'), { target: { value: 'flow commit' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(offlineApi.commitOfflineCurrentFlow).toHaveBeenCalledWith(1, '_flows/example/flow.yaml', 'flow commit'));

    fireEvent.click(screen.getByRole('button', { name: '提交仓库改动' }));
    fireEvent.change(await screen.findByPlaceholderText('例如：Update query conditions'), { target: { value: 'repo commit' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(offlineApi.commitOfflineRepo).toHaveBeenCalledWith(1, 'repo commit'));
});
```

Also extend the existing `vi.mock('../../api/offline', ...)` block in the same file so these exports are mocked:

```tsx
getOfflineFlowCommitStatus: vi.fn(),
commitOfflineCurrentFlow: vi.fn(),
commitOfflineRepo: vi.fn(),
pushOfflineRepo: vi.fn(),
```

- [ ] **Step 2: Run the frontend offline workbench test file to verify it fails**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npm run test -- src/views/offline/OfflineWorkbench.test.tsx
```

Expected: FAIL because the new APIs, button labels, and admin gate do not exist yet.

- [ ] **Step 3: Add the new offline APIs**

```ts
export interface OfflineFlowCommitStatus {
    groupId: number;
    flowPath: string;
    dirty: boolean;
}

export const getOfflineFlowCommitStatus = (groupId: number, flowPath: string) => {
    return request.get<unknown, OfflineFlowCommitStatus>(
        `/api/v1/offline/repo/commit/flow/status?groupId=${groupId}&path=${encodeURIComponent(flowPath)}`
    );
};

export const commitOfflineCurrentFlow = (groupId: number, flowPath: string, message: string) => {
    return request.post<unknown, CommitResult>(
        buildGroupScopedPath('/api/v1/offline/repo/commit/flow', groupId),
        { groupId, flowPath, message },
        { headers: { 'Content-Type': 'application/json' } }
    );
};

export const commitOfflineRepo = (groupId: number, message: string) => {
    return request.post<unknown, CommitResult>(
        buildGroupScopedPath('/api/v1/offline/repo/commit', groupId),
        { groupId, message },
        { headers: { 'Content-Type': 'application/json' } }
    );
};
```

- [ ] **Step 4: Split `OfflineWorkbench` UI and state**

```tsx
const isGroupAdmin = systemAdmin
    || permissions.includes('group.settings')
    || currentGroup?.role === 'GROUP_ADMIN';

const [flowCommitDialogOpen, setFlowCommitDialogOpen] = useState(false);
const [repoCommitDialogOpen, setRepoCommitDialogOpen] = useState(false);
const [flowCommitDirty, setFlowCommitDirty] = useState(false);

const refreshFlowCommitStatus = useCallback(async () => {
    if (!groupId || !activeFlowPath) {
        setFlowCommitDirty(false);
        return;
    }
    const result = await getOfflineFlowCommitStatus(groupId, activeFlowPath);
    setFlowCommitDirty(result.dirty);
}, [groupId, activeFlowPath]);

useEffect(() => {
    void refreshFlowCommitStatus();
}, [refreshFlowCommitStatus]);

const handleOpenFlowCommitDialog = useCallback(async () => {
    if (!groupId || !activeFlowPath || !flowCommitDirty) return;
    if (isDirty) {
        const saved = await handleSaveFlow();
        if (!saved) return;
    }
    setFlowCommitDialogOpen(true);
}, [groupId, activeFlowPath, flowCommitDirty, isDirty, handleSaveFlow]);

const handleOpenRepoCommitDialog = useCallback(async () => {
    if (!groupId) return;
    if (activeFlowPath && isDirty) {
        const saved = await handleSaveFlow();
        if (!saved) return;
    }
    setRepoCommitDialogOpen(true);
}, [groupId, activeFlowPath, isDirty, handleSaveFlow]);

const handleCurrentFlowCommit = useCallback(async () => {
    if (!groupId || !activeFlowPath) return;
    setCommitting(true);
    try {
        const result = await commitOfflineCurrentFlow(groupId, activeFlowPath, commitMessage);
        if (result.success) {
            setFlowCommitDialogOpen(false);
            setCommitMessage('');
            await Promise.all([refreshRepoStatus(), refreshFlowCommitStatus()]);
            showFeedback({ tone: 'success', title: result.message, detail: '' });
        }
    } finally {
        setCommitting(false);
    }
}, [groupId, activeFlowPath, commitMessage, refreshRepoStatus, refreshFlowCommitStatus, showFeedback]);

const handleRepoCommit = useCallback(async () => {
    if (!groupId) return;
    if (activeFlowPath && isDirty) {
        const saved = await handleSaveFlow();
        if (!saved) return;
    }
    setCommitting(true);
    try {
        const result = await commitOfflineRepo(groupId, commitMessage);
        if (result.success) {
            setRepoCommitDialogOpen(false);
            setCommitMessage('');
            await Promise.all([refreshRepoStatus(), refreshFlowCommitStatus()]);
            showFeedback({ tone: 'success', title: result.message, detail: '' });
        }
    } finally {
        setCommitting(false);
    }
}, [groupId, activeFlowPath, isDirty, handleSaveFlow, commitMessage, refreshRepoStatus, refreshFlowCommitStatus, showFeedback]);

<button
    type="button"
    className="offline-canvas-toolbar-btn"
    disabled={!activeFlowPath || !canWrite || !flowCommitDirty || committing}
    onClick={() => void handleOpenFlowCommitDialog()}
    aria-label="提交当前 Flow"
>
    <GitCommitHorizontal size={16} />
</button>
```

- [ ] **Step 5: Render the admin-only repo commit button next to push**

```tsx
{isGroupAdmin && (
    <Tooltip>
        <TooltipTrigger asChild>
            <button
                type="button"
                className="offline-rail-toolbar-btn"
                aria-label="提交仓库改动"
                onClick={() => void handleOpenRepoCommitDialog()}
                disabled={!groupId || committing || repoLoading || treeLoading}
            >
                <GitCommitHorizontal size={14} />
            </button>
        </TooltipTrigger>
        <TooltipContent className="tooltip-content" side="bottom">
            提交仓库改动
        </TooltipContent>
    </Tooltip>
)}

{isGroupAdmin && (
    <Tooltip>
        <TooltipTrigger asChild>
            <button
                type="button"
                className="offline-rail-toolbar-btn"
                aria-label="推送"
                onClick={() => void handlePush()}
                disabled={!groupId || pushLoading || repoLoading || treeLoading}
            >
                {pushLoading ? <LoaderCircle size={14} className="offline-spin" /> : <GitPushIcon dirty={!repoStatus?.dirty && !!repoStatus?.ahead} />}
            </button>
        </TooltipTrigger>
        <TooltipContent className="tooltip-content" side="bottom">
            推送
        </TooltipContent>
    </Tooltip>
)}
```

- [ ] **Step 6: Run the frontend offline workbench test file to verify it passes**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npm run test -- src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  wb-data-frontend/src/api/offline.ts \
  wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
  wb-data-frontend/src/views/offline/OfflineWorkbench.test.tsx
git commit -m "feat: split offline flow and repo commit UI"
```

### Task 5: Run full verification and clean up wording

**Files:**
- Modify: `wb-data-frontend/src/views/offline/OfflineWorkbench.tsx`
- Modify: `wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitPushService.java`

- [ ] **Step 1: Normalize user-facing success and empty-state messages**

```java
return new CommitResult(true, "当前 Flow 暂无改动需提交");
return new CommitResult(true, "当前 Flow 版本提交成功");
return new CommitResult(true, "仓库版本提交成功");
```

```tsx
<DialogTitle>提交当前 Flow</DialogTitle>
<DialogDescription>本次只提交当前 Flow 的定义、脚本和布局文件，其它未提交改动不会进入这次提交。</DialogDescription>

<DialogTitle>提交仓库改动</DialogTitle>
<DialogDescription>会提交当前项目组离线仓库内所有已落盘改动。</DialogDescription>
```

- [ ] **Step 2: Run targeted backend tests**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-server/wb-data-backend && mvn test -Dtest=OfflineRepoControllerPermissionTest,OfflineFlowDocumentServiceTest,GitPushServiceTest
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Run targeted frontend tests**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npm run test -- src/views/offline/OfflineWorkbench.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd /Users/wenbin/Projects/wb-data/wb-data-frontend && npm run build
```

Expected: Vite build completes successfully.

- [ ] **Step 5: Commit**

```bash
git add \
  wb-data-frontend/src/views/offline/OfflineWorkbench.tsx \
  wb-data-server/wb-data-backend/src/main/java/com/wbdata/offline/service/GitPushService.java
git commit -m "fix: finalize offline commit wording and validation"
```
