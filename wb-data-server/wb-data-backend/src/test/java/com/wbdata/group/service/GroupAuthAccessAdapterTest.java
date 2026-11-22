package com.wbdata.group.service;

import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.AuthGroupAccessPort;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.entity.WbUserGroupPreference;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.group.mapper.WbUserGroupPreferenceMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class GroupAuthAccessAdapterTest {

    private final WbProjectGroupMapper groupMapper = mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper memberMapper = mock(WbProjectGroupMemberMapper.class);
    private final WbUserGroupPreferenceMapper preferenceMapper = mock(WbUserGroupPreferenceMapper.class);
    private final GroupAuthAccessAdapter adapter =
            new GroupAuthAccessAdapter(groupMapper, memberMapper, preferenceMapper);

    @Test
    void listActiveGroupsForSystemAdminExcludesDisabledAndSetsSystemAdminRole() {
        WbProjectGroup active = group(1L, "Alpha", "active", LocalDateTime.of(2026, 11, 20, 10, 0));
        WbProjectGroup disabled = group(2L, "Beta", "disabled", LocalDateTime.of(2026, 11, 21, 10, 0));
        when(groupMapper.selectList(any())).thenReturn(List.of(disabled, active));

        List<ProjectGroupContextItem> items = adapter.listActiveGroupsForSystemAdmin();

        assertThat(items).containsExactly(new ProjectGroupContextItem(1L, "Alpha", "desc-1", "SYSTEM_ADMIN"));
        verifyNoInteractions(memberMapper);
    }

    @Test
    void listActiveGroupsForUserFiltersDisabledAndSortsDescendingByCreatedAt() {
        WbProjectGroup older = group(1L, "Alpha", "active", LocalDateTime.of(2026, 11, 20, 10, 0));
        WbProjectGroup newer = group(2L, "Gamma", "active", LocalDateTime.of(2026, 11, 22, 10, 0));
        WbProjectGroup disabled = group(3L, "Beta", "disabled", LocalDateTime.of(2026, 11, 21, 10, 0));
        when(memberMapper.selectList(any())).thenReturn(List.of(
                member(1L, 10L, "DEVELOPER"),
                member(2L, 10L, "GROUP_ADMIN"),
                member(3L, 10L, "DEVELOPER")));
        when(groupMapper.selectBatchIds(any())).thenReturn(List.of(older, disabled, newer));

        List<ProjectGroupContextItem> items = adapter.listActiveGroupsForUser(10L);

        assertThat(items).extracting(ProjectGroupContextItem::id, ProjectGroupContextItem::role)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(2L, "GROUP_ADMIN"),
                        org.assertj.core.groups.Tuple.tuple(1L, "DEVELOPER"));
    }

    @Test
    void findGroupAccessShortCircuitsDisabledGroupsAndSystemAdminMembershipLookup() {
        WbProjectGroup active = group(1L, "Alpha", "active", null);
        WbProjectGroup disabled = group(2L, "Beta", "disabled", null);
        when(groupMapper.selectById(1L)).thenReturn(active);
        when(groupMapper.selectById(2L)).thenReturn(disabled);
        when(groupMapper.selectById(99L)).thenReturn(null);
        when(memberMapper.selectOne(any())).thenReturn(member(1L, 10L, "DEVELOPER"));

        assertThat(adapter.findGroupAccess(99L, 10L, true)).isEmpty();
        assertThat(adapter.findGroupAccess(2L, 10L, true))
                .contains(new AuthGroupAccessPort.AuthGroupSnapshot(2L, "Beta", "disabled", null));
        assertThat(adapter.findGroupAccess(1L, 10L, false))
                .contains(new AuthGroupAccessPort.AuthGroupSnapshot(1L, "Alpha", "active", null));
        verify(memberMapper, never()).selectOne(any());

        assertThat(adapter.findGroupAccess(1L, 10L, true))
                .contains(new AuthGroupAccessPort.AuthGroupSnapshot(1L, "Alpha", "active", "DEVELOPER"));
    }

    @Test
    void preferenceMethodsDelegateLookupAndRecordSelection() {
        WbUserGroupPreference preference = new WbUserGroupPreference();
        preference.setGroupId(4L);
        when(preferenceMapper.selectOne(any())).thenReturn(preference);
        LocalDateTime now = LocalDateTime.of(2026, 11, 22, 12, 0);

        assertThat(adapter.findLastSelectedGroupId(10L)).contains(4L);
        adapter.recordGroupSelection(10L, 4L, now);
        verify(preferenceMapper).recordSelection(10L, 4L, now);
    }

    private static WbProjectGroup group(Long id, String name, String status, LocalDateTime createdAt) {
        WbProjectGroup g = new WbProjectGroup();
        g.setId(id);
        g.setName(name);
        g.setDescription("desc-" + id);
        g.setStatus(status);
        g.setCreatedAt(createdAt);
        return g;
    }

    private static WbProjectGroupMember member(Long groupId, Long userId, String role) {
        WbProjectGroupMember m = new WbProjectGroupMember();
        m.setGroupId(groupId);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }
}
