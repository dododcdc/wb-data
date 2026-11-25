package com.wbdata.workspace.dto;

import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionStatusCounts;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

public record WorkspaceSummaryResponse(
        Long groupId,
        String groupName,
        String role,
        boolean onboarding,
        DataSourceSummary datasources,
        OfflineSummary offline,
        OperationsSummary operations,
        ParameterSummary parameters,
        GitSyncSummary gitSync,
        MemberSummary members
) {
    public record DataSourceSummary(
            int total,
            int enabledCount,
            List<DataSourceTypeCount> byType,
            List<DataSourceBrief> items
    ) {
    }

    public record DataSourceTypeCount(
            String type,
            int count
    ) {
    }

    public record DataSourceBrief(
            Long id,
            String name,
            String type,
            String description,
            String databaseName,
            String status
    ) {
    }

    public record OfflineSummary(
            boolean repoInitialized,
            String branch,
            String workingTreeBranch,
            List<String> availableBranches,
            boolean dirty,
            boolean ahead,
            boolean hasRemote,
            boolean hasUpstream,
            String headCommitId,
            String headCommitMessage,
            Instant headCommitAt,
            int flowCount,
            int scheduledFlowCount,
            int dirtyFlowCount,
            List<RecentFlowItem> recentFlows
    ) {
    }

    public record RecentFlowItem(
            String path,
            String name,
            String directory,
            String scheduleState,
            String schedulePeriod,
            boolean dirty
    ) {
    }

    public record OperationsSummary(
            boolean available,
            String errorMessage,
            String selectedBranch,
            boolean branchSynced,
            List<String> availableBranches,
            OperationsExecutionStatusCounts counts,
            List<OperationsExecutionListItem> attentionExecutions,
            List<OperationsExecutionListItem> recentExecutions
    ) {
    }

    public record ParameterSummary(
            int activeCount
    ) {
    }

    public record GitSyncSummary(
            boolean configured,
            int enabledCount,
            String latestBranch,
            String latestStatus,
            LocalDateTime latestSyncAt,
            String latestMessage
    ) {
    }

    public record MemberSummary(
            int totalCount
    ) {
    }
}
