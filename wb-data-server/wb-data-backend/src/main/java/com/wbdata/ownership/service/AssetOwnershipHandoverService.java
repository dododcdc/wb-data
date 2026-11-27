package com.wbdata.ownership.service;

import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.TransferOwnerResponse;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.offline.service.OfflineFlowIndexService;
import com.wbdata.offline.service.OfflineFlowOwnerService;
import com.wbdata.ownership.dto.GroupAssetHandoverResponse;
import com.wbdata.ownership.dto.GroupMemberAssetSummaryResponse;
import com.wbdata.ownership.dto.UserAssetHandoverRequest;
import com.wbdata.ownership.dto.UserAssetHandoverResponse;
import com.wbdata.ownership.dto.UserAssetSummaryResponse;
import com.wbdata.parameter.service.ParameterGroupService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AssetOwnershipHandoverService {

    private final GroupOwnerService groupOwnerService;
    private final DataSourceService dataSourceService;
    private final ParameterGroupService parameterGroupService;
    private final OfflineFlowIndexService offlineFlowIndexService;
    private final OfflineFlowOwnerService offlineFlowOwnerService;
    private final WbProjectGroupMapper projectGroupMapper;

    public GroupMemberAssetSummaryResponse getGroupMemberAssetSummary(Long groupId, Long userId) {
        WbProjectGroup group = projectGroupMapper.selectById(groupId);
        if (group == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "项目组不存在");
        }
        long dataSources = dataSourceService.countByGroupAndOwner(groupId, userId);
        long parameterGroups = parameterGroupService.countByGroupAndOwner(groupId, userId);
        long offlineFlows = offlineFlowIndexService.countFlowsByGroupAndOwner(groupId, userId);
        return new GroupMemberAssetSummaryResponse(
                groupId,
                group.getName(),
                userId,
                dataSources,
                parameterGroups,
                offlineFlows,
                dataSources + parameterGroups + offlineFlows
        );
    }

    public UserAssetSummaryResponse getUserAssetSummary(Long userId) {
        Map<Long, Long> dsCounts = dataSourceService.countByOwnerAcrossGroups(userId);
        Map<Long, Long> pgCounts = parameterGroupService.countByOwnerAcrossGroups(userId);
        Map<Long, Long> flowCounts = offlineFlowIndexService.countFlowsByOwnerAcrossGroups(userId);

        Set<Long> affectedGroupIds = new LinkedHashSet<>();
        affectedGroupIds.addAll(dsCounts.keySet());
        affectedGroupIds.addAll(pgCounts.keySet());
        affectedGroupIds.addAll(flowCounts.keySet());

        if (affectedGroupIds.isEmpty()) {
            return new UserAssetSummaryResponse(userId, 0, 0, 0, 0, List.of());
        }

        Map<Long, WbProjectGroup> groupMap = projectGroupMapper.selectBatchIds(affectedGroupIds).stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(WbProjectGroup::getId, Function.identity()));

        List<GroupMemberAssetSummaryResponse> groupSummaries = new ArrayList<>();
        long totalDs = 0;
        long totalPg = 0;
        long totalFlows = 0;

        for (Long groupId : affectedGroupIds) {
            WbProjectGroup group = groupMap.get(groupId);
            if (group == null) {
                continue;
            }
            long ds = dsCounts.getOrDefault(groupId, 0L);
            long pg = pgCounts.getOrDefault(groupId, 0L);
            long flows = flowCounts.getOrDefault(groupId, 0L);
            long subtotal = ds + pg + flows;
            if (subtotal <= 0) {
                continue;
            }
            totalDs += ds;
            totalPg += pg;
            totalFlows += flows;
            groupSummaries.add(new GroupMemberAssetSummaryResponse(
                    groupId,
                    group.getName(),
                    userId,
                    ds,
                    pg,
                    flows,
                    subtotal
            ));
        }

        groupSummaries.sort(Comparator.comparing(GroupMemberAssetSummaryResponse::groupName, String.CASE_INSENSITIVE_ORDER));
        return new UserAssetSummaryResponse(
                userId,
                totalDs,
                totalPg,
                totalFlows,
                totalDs + totalPg + totalFlows,
                groupSummaries
        );
    }

    @Transactional
    public GroupAssetHandoverResponse handoverGroupMemberAssets(Long groupId,
                                                                Long fromUserId,
                                                                Long targetOwnerUserId,
                                                                Long operatorId) {
        if (fromUserId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "原负责人不能为空");
        }
        if (Objects.equals(fromUserId, targetOwnerUserId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "接手人不能与当前成员相同");
        }
        GroupOwnerInfo target = groupOwnerService.requireAssignableOwner(groupId, targetOwnerUserId);
        String targetName = target.effectiveName();

        int dsTransferred = dataSourceService.transferOwner(
                groupId, null, fromUserId, target.userId(), targetName, operatorId);
        int pgTransferred = parameterGroupService.transferAllFromOwnerInternal(
                groupId, operatorId, fromUserId, target.userId()).updatedCount();
        TransferOwnerResponse flowResult = offlineFlowOwnerService.transferAllFromOwnerInternal(
                groupId, fromUserId, target.userId());
        int flowTransferred = flowResult.updatedCount();

        return new GroupAssetHandoverResponse(
                groupId,
                fromUserId,
                target.userId(),
                targetName,
                dsTransferred,
                pgTransferred,
                flowTransferred,
                dsTransferred + pgTransferred + flowTransferred
        );
    }

    @Transactional
    public UserAssetHandoverResponse handoverUserAssets(Long fromUserId,
                                                        UserAssetHandoverRequest request,
                                                        Long operatorId) {
        if (request == null || request.transfers() == null || request.transfers().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请提供各项目组的交接配置");
        }
        Set<Long> seenGroupIds = new HashSet<>();
        List<GroupAssetHandoverResponse> results = new ArrayList<>(request.transfers().size());
        int totalTransferred = 0;
        for (UserAssetHandoverRequest.GroupTransferTarget transfer : request.transfers()) {
            if (!seenGroupIds.add(transfer.groupId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不可重复指定同一项目组: " + transfer.groupId());
            }
            GroupAssetHandoverResponse res = handoverGroupMemberAssets(
                    transfer.groupId(), fromUserId, transfer.targetOwnerUserId(), operatorId);
            results.add(res);
            totalTransferred += res.totalTransferred();
        }
        return new UserAssetHandoverResponse(fromUserId, totalTransferred, results);
    }
}
