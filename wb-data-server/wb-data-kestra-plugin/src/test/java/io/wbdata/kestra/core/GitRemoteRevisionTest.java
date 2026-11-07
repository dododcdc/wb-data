package io.wbdata.kestra.core;

import org.eclipse.jgit.api.Git;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GitRemoteRevisionTest {

    @TempDir
    Path repositoryDirectory;

    @Test
    void resolvesBranchHead() throws Exception {
        try (Git git = Git.init().setDirectory(repositoryDirectory.toFile()).call()) {
            Files.writeString(repositoryDirectory.resolve("probe.txt"), "s0");
            git.add().addFilepattern("probe.txt").call();
            String expectedSha = git.commit()
                    .setAuthor("S0", "s0@example.invalid")
                    .setCommitter("S0", "s0@example.invalid")
                    .setMessage("probe")
                    .call()
                    .getName();

            String actualSha = GitRemoteRevision.resolveBranchSha(
                    repositoryDirectory.toUri().toString(), git.getRepository().getBranch(), null, null);

            assertThat(actualSha).isEqualTo(expectedSha);
        }
    }

    @Test
    void rejectsMissingBranch() throws Exception {
        try (Git ignored = Git.init().setDirectory(repositoryDirectory.toFile()).call()) {
            assertThatThrownBy(() -> GitRemoteRevision.resolveBranchSha(
                    repositoryDirectory.toUri().toString(), "missing", null, null))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("missing");
        }
    }
}
