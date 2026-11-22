package com.wbdata.group.service;

import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.service.UserGroupMembershipPort;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class GroupMembershipAdapterTest {

    private final WbProjectGroupMapper groupMapper = mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper memberMapper = mock(WbProjectGroupMemberMapper.class);
    private final GroupMembershipAdapter adapter = new GroupMembershipAdapter(groupMapper, memberMapper);

    @Test
    void assertGroupsExistRejectsMissingGroup() {
        when(groupMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> adapter.assertGroupsExist(List.of(99L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void assignMembershipsInsertsAllSpecsWithAuditFields() {
        adapter.assignMemberships(5L, List.of(
                new UserGroupMembershipPort.MembershipSpec(1L, "DEVELOPER"),
                new UserGroupMembershipPort.MembershipSpec(2L, "GROUP_ADMIN")), 7L);

        ArgumentCaptor<WbProjectGroupMember> captor = ArgumentCaptor.forClass(WbProjectGroupMember.class);
        verify(memberMapper, org.mockito.Mockito.times(2)).insert(captor.capture());
        assertThat(captor.getAllValues()).extracting(
                        WbProjectGroupMember::getGroupId,
                        WbProjectGroupMember::getUserId,
                        WbProjectGroupMember::getRole,
                        WbProjectGroupMember::getCreatedBy,
                        WbProjectGroupMember::getUpdatedBy)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1L, 5L, "DEVELOPER", 7L, 7L),
                        org.assertj.core.groups.Tuple.tuple(2L, 5L, "GROUP_ADMIN", 7L, 7L));
    }

    @Test
    void syncMembershipsAppliesInsertUpdateAndDeleteDiff() {
        when(memberMapper.selectList(any())).thenReturn(List.of(
                member(11L, 1L, 5L, "DEVELOPER"),
                member(12L, 2L, 5L, "GROUP_ADMIN"),
                member(13L, 3L, 5L, "DEVELOPER")));

        adapter.syncMemberships(5L, List.of(
                new UserGroupMembershipPort.MembershipSpec(2L, "DEVELOPER"),
                new UserGroupMembershipPort.MembershipSpec(3L, "DEVELOPER"),
                new UserGroupMembershipPort.MembershipSpec(4L, "GROUP_ADMIN")), 7L);

        verify(memberMapper).deleteById(11L);

        ArgumentCaptor<WbProjectGroupMember> insertCaptor = ArgumentCaptor.forClass(WbProjectGroupMember.class);
        verify(memberMapper).insert(insertCaptor.capture());
        assertThat(insertCaptor.getValue().getGroupId()).isEqualTo(4L);
        assertThat(insertCaptor.getValue().getUserId()).isEqualTo(5L);

        ArgumentCaptor<WbProjectGroupMember> updateCaptor = ArgumentCaptor.forClass(WbProjectGroupMember.class);
        verify(memberMapper).updateById(updateCaptor.capture());
        assertThat(updateCaptor.getValue().getId()).isEqualTo(12L);
        assertThat(updateCaptor.getValue().getRole()).isEqualTo("DEVELOPER");
    }

    @Test
    void listUserGroupsReturnsEmptyWithoutBatchQueryWhenUserHasNoMemberships() {
        when(memberMapper.selectList(any())).thenReturn(List.of());

        assertThat(adapter.listUserGroups(5L)).isEmpty();
        verifyNoInteractions(groupMapper);
    }

    @Test
    void listUserGroupsMapsGroupNamesAndRoles() {
        when(memberMapper.selectList(any())).thenReturn(List.of(member(1L, 4L, 5L, "GROUP_ADMIN")));
        WbProjectGroup group = new WbProjectGroup();
        group.setId(4L);
        group.setName("Analytics");
        when(groupMapper.selectBatchIds(anyCollection())).thenReturn(List.of(group));

        assertThat(adapter.listUserGroups(5L))
                .containsExactly(new UserGroupMembershipPort.AssignedGroup(4L, "Analytics", "GROUP_ADMIN"));
    }

    private static WbProjectGroupMember member(Long id, Long groupId, Long userId, String role) {
        WbProjectGroupMember m = new WbProjectGroupMember();
        m.setId(id);
        m.setGroupId(groupId);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }
}
