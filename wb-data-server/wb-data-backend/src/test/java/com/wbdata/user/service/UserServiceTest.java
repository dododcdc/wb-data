package com.wbdata.user.service;

import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.user.dto.CreateUserRequest;
import com.wbdata.user.dto.GroupAssignment;
import com.wbdata.user.dto.ResetPasswordRequest;
import com.wbdata.user.dto.UpdateUserRequest;
import com.wbdata.user.dto.UpdateUserStatusRequest;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceTest {

    private final WbUserMapper userMapper = Mockito.mock(WbUserMapper.class);
    private final UserGroupMembershipPort groupMembershipPort = Mockito.mock(UserGroupMembershipPort.class);
    private final PasswordEncoder passwordEncoder = Mockito.mock(PasswordEncoder.class);
    private final UserService service = new UserService(userMapper, groupMembershipPort, passwordEncoder);

    @Test
    void listUsersMapsPageToPageResult() {
        WbUser alice = new WbUser();
        alice.setId(1L);
        alice.setUsername("alice");
        alice.setDisplayName("Alice");
        alice.setSystemRole("USER");
        alice.setStatus("ACTIVE");
        com.baomidou.mybatisplus.extension.plugins.pagination.Page<WbUser> page =
                new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(2, 20, 25);
        page.setRecords(List.of(alice));
        when(userMapper.selectPage(any(), any())).thenReturn(page);

        PageQuery query = new PageQuery();
        query.setPage(2);
        query.setSize(20);
        query.setKeyword("  ali ");
        PageResult<com.wbdata.user.dto.UserResponse> result = service.listUsers(query);

        assertThat(result.getTotal()).isEqualTo(25);
        assertThat(result.getCurrent()).isEqualTo(2);
        assertThat(result.getSize()).isEqualTo(20);
        assertThat(result.getRecords()).extracting(com.wbdata.user.dto.UserResponse::getUsername)
                .containsExactly("alice");
    }

    @Test
    void createUserConflictsWhenUsernameExists() {
        when(userMapper.exists(any())).thenReturn(true);

        assertThatThrownBy(() -> service.createUser(createRequest(), 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void createUserDefaultsRoleAndEncodesPassword() {
        when(userMapper.exists(any())).thenReturn(false);
        when(passwordEncoder.encode("raw-pass")).thenReturn("encoded-pass");
        when(userMapper.insert(any(WbUser.class))).thenAnswer(invocation -> {
            invocation.<WbUser>getArgument(0).setId(42L);
            return 1;
        });
        WbUser persisted = new WbUser();
        persisted.setId(42L);
        when(userMapper.selectById(42L)).thenReturn(persisted);

        service.createUser(createRequest(), 7L);

        ArgumentCaptor<WbUser> captor = ArgumentCaptor.forClass(WbUser.class);
        verify(userMapper).insert(captor.capture());
        WbUser inserted = captor.getValue();
        assertThat(inserted.getSystemRole()).isEqualTo("USER");
        assertThat(inserted.getStatus()).isEqualTo("ACTIVE");
        assertThat(inserted.getPasswordHash()).isEqualTo("encoded-pass");
        assertThat(inserted.getCreatedBy()).isEqualTo(7L);
    }

    @Test
    void createUserRejectsInvalidSystemRole() {
        when(userMapper.exists(any())).thenReturn(false);
        CreateUserRequest req = createRequest();
        req.setSystemRole("SUPER_ADMIN");

        assertThatThrownBy(() -> service.createUser(req, 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void createUserRejectsDuplicateGroupAssignment() {
        when(userMapper.exists(any())).thenReturn(false);
        CreateUserRequest req = createRequest();
        GroupAssignment assignment = new GroupAssignment();
        assignment.setGroupId(1L);
        assignment.setGroupRole("DEVELOPER");
        GroupAssignment duplicate = new GroupAssignment();
        duplicate.setGroupId(1L);
        duplicate.setGroupRole("GROUP_ADMIN");
        req.setGroupAssignments(List.of(assignment, duplicate));

        assertThatThrownBy(() -> service.createUser(req, 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void createUserRejectsUnknownGroup() {
        when(userMapper.exists(any())).thenReturn(false);
        doThrow(new ResponseStatusException(HttpStatus.BAD_REQUEST, "指定的项目组不存在"))
                .when(groupMembershipPort).assertGroupsExist(any());
        CreateUserRequest req = createRequest();
        GroupAssignment assignment = new GroupAssignment();
        assignment.setGroupId(99L);
        assignment.setGroupRole("DEVELOPER");
        req.setGroupAssignments(List.of(assignment));

        assertThatThrownBy(() -> service.createUser(req, 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void updateUserNotFoundWhenUserMissing() {
        when(userMapper.selectForUpdate(99L)).thenReturn(null);

        assertThatThrownBy(() -> service.updateUser(99L, new UpdateUserRequest(), 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void updateUserRejectsSelfSystemRoleChange() {
        WbUser existing = new WbUser();
        existing.setId(7L);
        when(userMapper.selectForUpdate(7L)).thenReturn(existing);
        UpdateUserRequest req = new UpdateUserRequest();
        req.setSystemRole("SYSTEM_ADMIN");

        assertThatThrownBy(() -> service.updateUser(7L, req, 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void updateUserSyncsMembershipDiff() {
        WbUser existing = new WbUser();
        existing.setId(5L);
        when(userMapper.selectForUpdate(5L)).thenReturn(existing);
        when(userMapper.selectById(5L)).thenReturn(existing);

        UpdateUserRequest req = new UpdateUserRequest();
        req.setGroupAssignments(List.of(
                assignment(2L, "DEVELOPER"),
                assignment(3L, "DEVELOPER"),
                assignment(4L, "GROUP_ADMIN")));

        service.updateUser(5L, req, 7L);

        verify(groupMembershipPort).assertGroupsExist(any());
        ArgumentCaptor<List<UserGroupMembershipPort.MembershipSpec>> specsCaptor = ArgumentCaptor.forClass(List.class);
        verify(groupMembershipPort).syncMemberships(eq(5L), specsCaptor.capture(), eq(7L));
        assertThat(specsCaptor.getValue()).containsExactly(
                new UserGroupMembershipPort.MembershipSpec(2L, "DEVELOPER"),
                new UserGroupMembershipPort.MembershipSpec(3L, "DEVELOPER"),
                new UserGroupMembershipPort.MembershipSpec(4L, "GROUP_ADMIN")
        );
    }

    @Test
    void changeStatusRejectsDisablingSelf() {
        WbUser existing = new WbUser();
        existing.setId(7L);
        when(userMapper.selectForUpdate(7L)).thenReturn(existing);
        UpdateUserStatusRequest req = new UpdateUserStatusRequest();
        req.setStatus("DISABLED");

        assertThatThrownBy(() -> service.changeStatus(7L, req, 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(userMapper, never()).updateById(any(WbUser.class));
    }

    @Test
    void resetPasswordStoresEncodedHash() {
        WbUser existing = new WbUser();
        existing.setId(5L);
        when(userMapper.selectForUpdate(5L)).thenReturn(existing);
        when(userMapper.selectById(5L)).thenReturn(existing);
        when(passwordEncoder.encode("new-pass")).thenReturn("encoded-new");

        ResetPasswordRequest req = new ResetPasswordRequest();
        req.setNewPassword("new-pass");
        service.resetPassword(5L, req, 7L);

        ArgumentCaptor<WbUser> captor = ArgumentCaptor.forClass(WbUser.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordHash()).isEqualTo("encoded-new");
        assertThat(captor.getValue().getAuthVersion()).isNull();
        verify(userMapper).incrementAuthVersion(5L);
    }

    @Test
    void systemRoleChangeIncrementsSessionVersion() {
        WbUser existing = new WbUser();
        existing.setSystemRole("SYSTEM_ADMIN");
        when(userMapper.selectForUpdate(5L)).thenReturn(existing);
        when(userMapper.selectById(5L)).thenReturn(existing);
        UpdateUserRequest req = new UpdateUserRequest();
        req.setSystemRole("USER");

        service.updateUser(5L, req, 7L);

        verify(userMapper).incrementAuthVersion(5L);
    }

    @Test
    void unchangedRoleAndDisplayNameChangeDoNotRevokeSessions() {
        WbUser existing = new WbUser();
        existing.setSystemRole("USER");
        when(userMapper.selectForUpdate(5L)).thenReturn(existing);
        when(userMapper.selectById(5L)).thenReturn(existing);
        UpdateUserRequest req = new UpdateUserRequest();
        req.setSystemRole("USER");
        req.setDisplayName("New name");

        service.updateUser(5L, req, 7L);
        req.setSystemRole(null);
        service.updateUser(5L, req, 7L);

        verify(userMapper, never()).incrementAuthVersion(anyLong());
    }

    @Test
    void statusTransitionIncrementsSessionVersion() {
        WbUser existing = new WbUser();
        existing.setStatus("ACTIVE");
        when(userMapper.selectForUpdate(5L)).thenReturn(existing);
        UpdateUserStatusRequest req = new UpdateUserStatusRequest();
        req.setStatus("DISABLED");

        service.changeStatus(5L, req, 7L);

        verify(userMapper).incrementAuthVersion(5L);
    }

    @Test
    void unchangedStatusDoesNotRevokeSessions() {
        WbUser existing = new WbUser();
        existing.setStatus("ACTIVE");
        when(userMapper.selectForUpdate(5L)).thenReturn(existing);
        UpdateUserStatusRequest req = new UpdateUserStatusRequest();
        req.setStatus("ACTIVE");

        service.changeStatus(5L, req, 7L);

        verify(userMapper, never()).incrementAuthVersion(anyLong());
    }

    @Test
    void failedPasswordEncodingDoesNotChangeAccountOrVersion() {
        when(userMapper.selectForUpdate(5L)).thenReturn(new WbUser());
        when(passwordEncoder.encode("new-pass")).thenThrow(new IllegalStateException("encoder failure"));
        ResetPasswordRequest req = new ResetPasswordRequest();
        req.setNewPassword("new-pass");

        assertThatThrownBy(() -> service.resetPassword(5L, req, 7L)).isInstanceOf(IllegalStateException.class);

        verify(userMapper, never()).updateById(any(WbUser.class));
        verify(userMapper, never()).incrementAuthVersion(anyLong());
    }

    private static CreateUserRequest createRequest() {
        CreateUserRequest req = new CreateUserRequest();
        req.setUsername("alice");
        req.setDisplayName("Alice");
        req.setPassword("raw-pass");
        return req;
    }

    private static GroupAssignment assignment(Long groupId, String role) {
        GroupAssignment assignment = new GroupAssignment();
        assignment.setGroupId(groupId);
        assignment.setGroupRole(role);
        return assignment;
    }
}
