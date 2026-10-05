package com.wbdata.offline.service;

import com.wbdata.offline.dto.DirtyFlowChangeResponse;
import com.wbdata.offline.dto.DirtyWorkingTreeResponse;
import com.wbdata.offline.exception.DirtyWorkingTreeException;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 脏工作树检测：把 git status 解析成按任务 flow 归并的变更摘要，
 * 分支切换 / 合并前的清洁校验与前端提示共用同一套归并规则。
 */
class GitWorkingTreeStatus {

    void ensureClean(String statusOutput) {
        if (statusOutput.isBlank()) {
            return;
        }
        List<GitStatusEntry> changedFiles = statusOutput.lines()
                .map(this::parseStatusEntry)
                .filter(entry -> !entry.path().isBlank())
                .toList();
        throw new DirtyWorkingTreeException(summarizeDirtyWorkingTree(changedFiles));
    }

    private DirtyWorkingTreeResponse summarizeDirtyWorkingTree(List<GitStatusEntry> changedFiles) {
        Map<String, String> changedFlows = new LinkedHashMap<>();
        Set<String> rawChangedFiles = new LinkedHashSet<>();
        int otherFileCount = 0;
        for (GitStatusEntry changedFile : changedFiles) {
            rawChangedFiles.add(changedFile.path());
            String flowPath = resolveChangedFlowPath(changedFile);
            if (flowPath == null) {
                otherFileCount++;
            } else {
                changedFlows.merge(flowPath, changedFile.flowStatus(), this::mergeFlowStatus);
            }
        }
        List<String> changedFlowPaths = List.copyOf(changedFlows.keySet());
        List<DirtyFlowChangeResponse> changedFlowDetails = changedFlows.entrySet().stream()
                .map(entry -> new DirtyFlowChangeResponse(entry.getKey(), entry.getValue()))
                .toList();
        return new DirtyWorkingTreeResponse(changedFlowPaths, List.copyOf(rawChangedFiles), otherFileCount, changedFlowDetails);
    }

    private String resolveChangedFlowPath(GitStatusEntry changedFile) {
        if ("ADDED".equals(changedFile.flowStatus())
                && changedFile.path().startsWith("_flows/")
                && changedFile.path().endsWith("/")) {
            return Path.of(changedFile.path()).resolve("flow.yaml").toString();
        }
        return resolveChangedFlowPath(changedFile.path());
    }

    private String resolveChangedFlowPath(String changedFile) {
        Path path = Path.of(changedFile).normalize();
        if (path.isAbsolute() || path.getNameCount() < 2) {
            return null;
        }
        String root = path.getName(0).toString();
        String fileName = path.getFileName().toString();

        if ("_flows".equals(root)) {
            if ("flow.yaml".equals(fileName)) {
                return path.toString();
            }
            if ((".layout.json".equals(fileName) || ".parameters.json".equals(fileName))
                    && path.getParent() != null) {
                return path.getParent().resolve("flow.yaml").toString();
            }
            return null;
        }

        if ("scripts".equals(root) && path.getNameCount() >= 3 && path.getParent() != null) {
            Path scriptDirectory = path.getParent();
            Path flowDirectory = Path.of("_flows");
            for (int i = 1; i < scriptDirectory.getNameCount(); i++) {
                flowDirectory = flowDirectory.resolve(scriptDirectory.getName(i).toString());
            }
            return flowDirectory.resolve("flow.yaml").toString();
        }
        return null;
    }

    private GitStatusEntry parseStatusEntry(String statusLine) {
        if (statusLine.length() <= 2) {
            return new GitStatusEntry(statusLine.trim(), "MODIFIED");
        }
        String statusCode = statusLine.substring(0, 2);
        String path = statusLine.substring(2).trim();
        int renameArrow = path.indexOf(" -> ");
        String normalizedPath = renameArrow >= 0 ? path.substring(renameArrow + 4).trim() : path;
        return new GitStatusEntry(normalizedPath, resolveFlowStatus(statusCode));
    }

    private String resolveFlowStatus(String statusCode) {
        if (statusCode.indexOf('D') >= 0) {
            return "DELETED";
        }
        if (statusCode.indexOf('A') >= 0 || statusCode.contains("?")) {
            return "ADDED";
        }
        return "MODIFIED";
    }

    private String mergeFlowStatus(String existing, String next) {
        if ("DELETED".equals(existing) || "DELETED".equals(next)) {
            return "DELETED";
        }
        if ("ADDED".equals(existing) || "ADDED".equals(next)) {
            return "ADDED";
        }
        return "MODIFIED";
    }

    private record GitStatusEntry(String path, String flowStatus) {
    }
}
