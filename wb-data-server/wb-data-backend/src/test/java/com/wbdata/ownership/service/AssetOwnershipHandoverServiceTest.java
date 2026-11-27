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
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AssetOwnershipHandoverServiceTest {

    @Test
    void summarizesAndHandsOverGroupAndCrossGroupAssets() {
        GroupOwnerService groupOwnerService = mock(GroupOwnerService.class);
        DataSourceService dataSourceService = mock(DataSourceService.class);
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowIndexService offlineFlowIndexService = mock(OfflineFlowIndexService.class);
        OfflineFlowOwnerService offlineFlowOwnerService = mock(OfflineFlowOwnerService.class);
        WbProjectGroupMapper projectGroupMapper = mock(WbProjectGroupMapper.class);

        WbProjectGroup group1 = new WbProjectGroup();
        group1.setId(1L);
        group1.setName("Analytics");
        WbProjectGroup group2 = new WbProjectGroup();
        group2.setId(2L);
        group2.setName("Finance");

        when(projectGroupMapper.selectById(1L)).thenReturn(group1);
        when(projectGroupMapper.selectBatchIds(Set.of(1L, 2L))).thenReturn(List.of(group1, group2));

        when(dataSourceService.countByGroupAndOwner(1L, 10L)).thenReturn(2L);
        when(parameterGroupService.countByGroupAndOwner(1L, 10L)).thenReturn(1L);
        when(offlineFlowIndexService.countFlowsByGroupAndOwner(1L, 10L)).thenReturn(3L);

        when(dataSourceService.countByOwnerAcrossGroups(10L)).thenReturn(Map.of(1L, 2L, 2L, 1L));
        when(parameterGroupService.countByOwnerAcrossGroups(10L)).thenReturn(Map.of(1L, 1L));
        when(offlineFlowIndexService.countFlowsByOwnerAcrossGroups(10L)).thenReturn(Map.of(1L, 3L, 2L, 4L));

        when(groupOwnerService.requireAssignableOwner(1L, 20L))
                .thenReturn(new GroupOwnerInfo(20L, "bob", "Bob", "ACTIVE"));
        when(groupOwnerService.requireAssignableOwner(2L, 30L))
                .thenReturn(new GroupOwnerInfo(30L, "carol", "Carol", "ACTIVE"));

        when(dataSourceService.transferOwner(1L, null, 10L, 20L, "Bob", 99L)).thenReturn(2);
        when(parameterGroupService.transferAllFromOwnerInternal(1L, 99L, 10L, 20L))
                .thenReturn(new TransferOwnerResponse(1, 20L, "Bob"));
        when(offlineFlowOwnerService.transferAllFromOwnerInternal(1L, 10L, 20L))
                .thenReturn(new TransferOwnerResponse(3, 20L, "Bob"));

        when(dataSourceService.transferOwner(2L, null, 10L, 30L, "Carol", 99L)).thenReturn(1);
        when(parameterGroupService.transferAllFromOwnerInternal(2L, 99L, 10L, 30L))
                .thenReturn(new TransferOwnerResponse(0, 30L, "Carol"));
        when(offlineFlowOwnerService.transferAllFromOwnerInternal(2L, 10L, 30L))
                .thenReturn(new TransferOwnerResponse(4, 30L, "Carol"));

        AssetOwnershipHandoverService service = new AssetOwnershipHandoverService(
                groupOwnerService, dataSourceService, parameterGroupService,
                offlineFlowIndexService, offlineFlowOwnerService, projectGroupMapper);

        GroupMemberAssetSummaryResponse groupSummary = service.getGroupMemberAssetSummary(1L, 10L);
        assertThat(groupSummary.totalCount()).isEqualTo(6L);
        assertThat(groupSummary.dataSourceCount()).isEqualTo(2L);
        assertThat(groupSummary.parameterGroupCount()).isEqualTo(1L);
        assertThat(groupSummary.offlineFlowCount()).isEqualTo(3L);

        UserAssetSummaryResponse userSummary = service.getUserAssetSummary(10L);
        assertThat(userSummary.totalCount()).isEqualTo(11L);
        assertThat(userSummary.groups()).hasSize(2);

        GroupAssetHandoverResponse groupHandover = service.handoverGroupMemberAssets(1L, 10L, 20L, 99L);
        assertThat(groupHandover.totalTransferred()).isEqualTo(6);
        assertThat(groupHandover.targetOwnerName()).isEqualTo("Bob");

        UserAssetHandoverResponse userHandover = service.handoverUserAssets(10L, new UserAssetHandoverRequest(List.of(
                new UserAssetHandoverRequest.GroupTransferTarget(1L, 20L),
                new UserAssetHandoverRequest.GroupTransferTarget(2L, 30L)
        )), 99L);
        assertThat(userHandover.totalTransferred()).isEqualTo(11);
        verify(offlineFlowOwnerService).transferAllFromOwnerInternal(2L, 10L, 30L);

        assertThatThrownBy(() -> service.handoverGroupMemberAssets(1L, 10L, 10L, 99L))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("相同");
    }
}
