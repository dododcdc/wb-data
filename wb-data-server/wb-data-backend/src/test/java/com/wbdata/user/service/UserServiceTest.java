package com.wbdata.user.service;

import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceTest {

    private final WbUserMapper userMapper = Mockito.mock(WbUserMapper.class);
    private final WbProjectGroupMapper groupMapper = Mockito.mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper groupMemberMapper = Mockito.mock(WbProjectGroupMemberMapper.class);
    private final PasswordEncoder passwordEncoder = Mockito.mock(PasswordEncoder.class);
    private final UserService service = new UserService(userMapper, groupMapper, groupMemberMapper, passwordEncoder);

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
        when(groupMapper.selectById(anyLong())).thenReturn(null);
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
        when(userMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> service.updateUser(99L, new UpdateUserRequest(), 7L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void updateUserRejectsSelfSystemRoleChange() {
        WbUser existing = new WbUser();
        existing.setId(7L);
        when(userMapper.selectById(7L)).thenReturn(existing);
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
        when(userMapper.selectById(5L)).thenReturn(existing);
        when(groupMapper.selectById(anyLong())).thenReturn(new WbProjectGroup());

        WbProjectGroupMember removed = member(11L, 1L, "DEVELOPER");
        WbProjectGroupMember roleChanged = member(12L, 2L, "GROUP_ADMIN");
        WbProjectGroupMember untouched = member(13L, 3L, "DEVELOPER");
        when(groupMemberMapper.selectList(any())).thenReturn(List.of(removed, roleChanged, untouched));

        UpdateUserRequest req = new UpdateUserRequest();
        req.setGroupAssignments(List.of(assignment(2L, "DEVELOPER"), assignment(3L, "DEVELOPER"), assignment(4L, "GROUP_ADMIN")));

        service.updateUser(5L, req, 7L);

        verify(groupMemberMapper).deleteById(11L);

        ArgumentCaptor<WbProjectGroupMember> insertCaptor = ArgumentCaptor.forClass(WbProjectGroupMember.class);
        verify(groupMemberMapper).insert(insertCaptor.capture());
        assertThat(insertCaptor.getValue().getGroupId()).isEqualTo(4L);
        assertThat(insertCaptor.getValue().getUserId()).isEqualTo(5L);

        ArgumentCaptor<WbProjectGroupMember> updateCaptor = ArgumentCaptor.forClass(WbProjectGroupMember.class);
        verify(groupMemberMapper).updateById(updateCaptor.capture());
        assertThat(updateCaptor.getValue().getId()).isEqualTo(12L);
        assertThat(updateCaptor.getValue().getRole()).isEqualTo("DEVELOPER");
    }

    @Test
    void changeStatusRejectsDisablingSelf() {
        WbUser existing = new WbUser();
        existing.setId(7L);
        when(userMapper.selectById(7L)).thenReturn(existing);
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
        when(userMapper.selectById(5L)).thenReturn(existing);
        when(passwordEncoder.encode("new-pass")).thenReturn("encoded-new");

        ResetPasswordRequest req = new ResetPasswordRequest();
        req.setNewPassword("new-pass");
        service.resetPassword(5L, req, 7L);

        ArgumentCaptor<WbUser> captor = ArgumentCaptor.forClass(WbUser.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordHash()).isEqualTo("encoded-new");
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

    private static WbProjectGroupMember member(Long id, Long groupId, String role) {
        WbProjectGroupMember member = new WbProjectGroupMember();
        member.setId(id);
        member.setGroupId(groupId);
        member.setUserId(5L);
        member.setRole(role);
        return member;
    }
}
