package com.wbdata.group.service;

import com.wbdata.auth.enums.GroupRole;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.group.dto.AddMemberRequest;
import com.wbdata.group.dto.AddMembersRequest;
import com.wbdata.group.dto.AvailableUserResponse;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GroupSettingsServiceTest {

    @Mock
    private WbProjectGroupMapper groupMapper;

    @Mock
    private WbProjectGroupMemberMapper memberMapper;

    @Mock
    private WbProjectGroupMemberService memberService;

    @Mock
    private WbUserMapper userMapper;

    @InjectMocks
    private GroupSettingsService service;

    @Test
    void listAvailableUsers_excludesSystemAdminAccounts() {
        com.baomidou.mybatisplus.extension.plugins.pagination.Page<com.wbdata.user.entity.WbUser> pageResult = new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>();
        pageResult.setRecords(List.of(activeUser(7L, "dev_alpha", "Dev Alpha", "USER")));

        when(userMapper.selectAvailableUsers(any(), any(), any())).thenReturn((com.baomidou.mybatisplus.core.metadata.IPage) pageResult);

        com.wbdata.common.dto.PageQuery pageQuery = new com.wbdata.common.dto.PageQuery();
        pageQuery.setPage(1);
        pageQuery.setSize(50);
        pageQuery.setKeyword("a");
        List<AvailableUserResponse> result = service.listAvailableUsers(12L, pageQuery).getRecords();

        assertThat(result)
                .extracting(AvailableUserResponse::getUsername)
                .containsExactly("dev_alpha");
    }

    @Test
    void addMember_rejectsSystemAdminAccounts() {
        AddMemberRequest req = new AddMemberRequest();
        req.setUserId(8L);
        req.setRole(GroupRole.DEVELOPER.name());

        when(userMapper.selectById(8L)).thenReturn(activeUser(8L, "sys_admin", "System Admin", SystemRole.SYSTEM_ADMIN.name()));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> service.addMember(12L, req, 99L));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getReason()).contains("系统管理员");
        verify(memberMapper, never()).insert(any(WbProjectGroupMember.class));
    }

    @Test
    void addMembers_insertsAllRequestedUsers() {
        AddMembersRequest req = new AddMembersRequest();
        req.setUserIds(List.of(7L, 8L));
        req.setRole(GroupRole.GROUP_ADMIN.name());

        when(userMapper.selectBatchIds(anyList())).thenReturn(List.of(
                activeUser(7L, "bob", "Bob", "USER"),
                activeUser(8L, "alice", "Alice", "USER")
        ));
        when(memberMapper.selectList(any())).thenReturn(List.of());

        service.addMembers(12L, req, 99L);

        ArgumentCaptor<List<WbProjectGroupMember>> captor = ArgumentCaptor.forClass(List.class);
        verify(memberService).saveBatch(captor.capture());
        assertThat(captor.getValue())
                .extracting(
                        WbProjectGroupMember::getGroupId,
                        WbProjectGroupMember::getUserId,
                        WbProjectGroupMember::getRole,
                        WbProjectGroupMember::getCreatedBy,
                        WbProjectGroupMember::getUpdatedBy
                )
                .containsExactly(
                        tuple(12L, 7L, GroupRole.GROUP_ADMIN.name(), 99L, 99L),
                        tuple(12L, 8L, GroupRole.GROUP_ADMIN.name(), 99L, 99L)
                );
    }

    @Test
    void addMembers_rejectsSystemAdminAccountsWithoutPartialInsert() {
        AddMembersRequest req = new AddMembersRequest();
        req.setUserIds(List.of(7L, 8L));
        req.setRole(GroupRole.DEVELOPER.name());

        when(userMapper.selectBatchIds(anyList())).thenReturn(List.of(
                activeUser(7L, "bob", "Bob", "USER"),
                activeUser(8L, "sys_admin", "System Admin", SystemRole.SYSTEM_ADMIN.name())
        ));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> service.addMembers(12L, req, 99L));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getReason()).contains("系统管理员");
        verify(memberMapper, never()).insert(any(WbProjectGroupMember.class));
    }

    private static WbUser activeUser(Long id, String username, String displayName, String systemRole) {
        WbUser user = new WbUser();
        user.setId(id);
        user.setUsername(username);
        user.setDisplayName(displayName);
        user.setSystemRole(systemRole);
        user.setStatus("ACTIVE");
        return user;
    }
}
