package com.wbdata.auth.service;

import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.entity.WbUserGroupPreference;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.group.mapper.WbUserGroupPreferenceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AuthContextServiceTest {
    private final WbProjectGroupMapper groups = mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper members = mock(WbProjectGroupMemberMapper.class);
    private final WbUserGroupPreferenceMapper preferences = mock(WbUserGroupPreferenceMapper.class);
    private final AuthContextService service = new AuthContextService(groups, members, preferences, new PermissionService());
    private final WbProjectGroup active = new WbProjectGroup();
    private final WbProjectGroup disabled = new WbProjectGroup();
    private final AuthSession user = new AuthSession(10L, "member", "Member", "USER", Instant.now().plusSeconds(600));

    @BeforeEach
    void setUp() {
        active.setId(1L);
        active.setName("Active");
        disabled.setId(2L);
        disabled.setName("Disabled");
        disabled.setStatus("disabled");
        when(groups.selectBatchIds(any())).thenReturn(List.of(active, disabled));
        when(groups.selectList(any())).thenReturn(List.of(active, disabled));
        when(members.selectList(any())).thenReturn(List.of(member(1L), member(2L)));
    }

    @Test
    void readingExplicitContextNeverTouchesPreferences() {
        var context = service.getContext(user, 1L);
        assertThat(context.currentGroup().id()).isEqualTo(1L);
        assertThat(context.accessibleGroups()).extracting(item -> item.id()).containsExactly(1L);
        assertThat(context.permissions()).contains("offline.write").doesNotContain("member.manage");
        verifyNoInteractions(preferences);
    }

    @Test
    void choosingGroupRecordsPreferenceOnlyOnce() {
        assertThat(service.selectGroup(user, 1L).currentGroup().id()).isEqualTo(1L);
        verify(preferences).recordSelection(eq(10L), eq(1L), any());
        verifyNoMoreInteractions(preferences);
    }

    @Test
    void disabledGroupIsHiddenFromSystemAdministratorWorkspace() {
        var admin = new AuthSession(20L, "admin", "Admin", "SYSTEM_ADMIN", user.expiresAt());
        assertThat(service.getContext(admin, 1L).accessibleGroups()).extracting(item -> item.id()).containsExactly(1L);
        verifyNoInteractions(preferences);
    }

    @Test
    void selectingUnavailableGroupCannotUpdatePreference() {
        assertThatThrownBy(() -> service.selectGroup(user, 2L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verifyNoInteractions(preferences);
    }

    @Test
    void removedLastMembershipRejectsExplicitGroupButAllowsNoGroupContext() {
        when(members.selectList(any())).thenReturn(List.of());
        assertThat(service.getContext(user, null).currentGroup()).isNull();
        assertThatThrownBy(() -> service.getContext(user, 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verifyNoInteractions(preferences);
    }

    @Test
    void defaultGroupIgnoresDisabledPreferenceWithoutWritingReplacement() {
        var preference = new WbUserGroupPreference();
        preference.setGroupId(2L);
        when(preferences.selectOne(any())).thenReturn(preference);
        assertThat(service.getContext(user, null).currentGroup().id()).isEqualTo(1L);
        verify(preferences).selectOne(any());
        verifyNoMoreInteractions(preferences);
    }

    private WbProjectGroupMember member(Long groupId) {
        var member = new WbProjectGroupMember();
        member.setUserId(user.id());
        member.setGroupId(groupId);
        member.setRole("DEVELOPER");
        return member;
    }
}
