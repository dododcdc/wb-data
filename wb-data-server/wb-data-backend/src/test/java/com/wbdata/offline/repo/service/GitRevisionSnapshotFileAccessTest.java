package com.wbdata.offline.repo.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GitRevisionSnapshotFileAccessTest {

    @Test
    void cachesPresentAndMissingRevisionFilesAcrossExistsAndReadString() {
        GitCommandService gitCommandService = mock(GitCommandService.class);
        when(gitCommandService.readFileAtRevision(1L, "aaaaaaa", "_flows/demo/flow.yaml"))
                .thenReturn("id: demo");
        when(gitCommandService.readFileAtRevision(1L, "aaaaaaa", "_flows/demo/missing.txt"))
                .thenThrow(new GitRepositoryOperations.GitException("missing"));

        GitRevisionSnapshotFileAccess access = new GitRevisionSnapshotFileAccess(1L, "aaaaaaa", gitCommandService);
        Path repoPath = Path.of("/tmp/repo");

        assertThat(access.exists(repoPath, "_flows/demo/flow.yaml")).isTrue();
        assertThat(access.readString(repoPath, "_flows/demo/flow.yaml")).isEqualTo("id: demo");
        assertThat(access.exists(repoPath, "_flows/demo/missing.txt")).isFalse();
        assertThat(access.exists(repoPath, "_flows/demo/missing.txt")).isFalse();
        assertThatThrownBy(() -> access.readString(repoPath, "_flows/demo/missing.txt"))
                .isInstanceOf(GitRepositoryOperations.GitException.class);

        verify(gitCommandService, times(1)).readFileAtRevision(1L, "aaaaaaa", "_flows/demo/flow.yaml");
        verify(gitCommandService, times(1)).readFileAtRevision(1L, "aaaaaaa", "_flows/demo/missing.txt");
    }

    @Test
    void readStringCachesMissingRevisionFilesAcrossRepeatedCalls() {
        GitCommandService gitCommandService = mock(GitCommandService.class);
        when(gitCommandService.readFileAtRevision(1L, "aaaaaaa", "_flows/demo/missing.txt"))
                .thenThrow(new GitRepositoryOperations.GitException("missing"));

        GitRevisionSnapshotFileAccess access = new GitRevisionSnapshotFileAccess(1L, "aaaaaaa", gitCommandService);
        Path repoPath = Path.of("/tmp/repo");

        assertThatThrownBy(() -> access.readString(repoPath, "_flows/demo/missing.txt"))
                .isInstanceOf(GitRepositoryOperations.GitException.class);
        assertThat(access.exists(repoPath, "_flows/demo/missing.txt")).isFalse();
        assertThatThrownBy(() -> access.readString(repoPath, "_flows/demo/missing.txt"))
                .isInstanceOf(GitRepositoryOperations.GitException.class);

        verify(gitCommandService, times(1)).readFileAtRevision(1L, "aaaaaaa", "_flows/demo/missing.txt");
    }

    @Test
    void propagatesBadRequestErrorsInsteadOfMaskingAsMissing() {
        GitCommandService gitCommandService = mock(GitCommandService.class);
        when(gitCommandService.readFileAtRevision(1L, "bad-rev", "_flows/demo/flow.yaml"))
                .thenThrow(new ResponseStatusException(HttpStatus.BAD_REQUEST, "非法 Git revision"));

        GitRevisionSnapshotFileAccess access = new GitRevisionSnapshotFileAccess(1L, "bad-rev", gitCommandService);

        assertThatThrownBy(() -> access.exists(Path.of("/tmp/repo"), "_flows/demo/flow.yaml"))
                .isInstanceOf(ResponseStatusException.class);
    }
}
