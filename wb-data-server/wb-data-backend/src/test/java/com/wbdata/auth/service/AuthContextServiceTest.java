package com.wbdata.auth.service;

import com.wbdata.auth.dto.ProjectGroupContextItem;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class AuthContextServiceTest {
    private final AuthGroupAccessPort groupAccess = mock(AuthGroupAccessPort.class);
    private final AuthContextService service = new AuthContextService(groupAccess, new PermissionService());
    private final ProjectGroupContextItem activeForUser = new ProjectGroupContextItem(1L, "Active", null, "DEVELOPER");
    private final ProjectGroupContextItem activeForAdmin = new ProjectGroupContextItem(1L, "Active", null, "SYSTEM_ADMIN");
    private final AuthSession user = new AuthSession(10L, "member", "Member", "USER", Instant.now().plusSeconds(600));

    @BeforeEach
    void setUp() {
        when(groupAccess.listActiveGroupsForSystemAdmin()).thenReturn(List.of(activeForAdmin));
        when(groupAccess.listActiveGroupsForUser(10L)).thenReturn(List.of(activeForUser));
        when(groupAccess.findLastSelectedGroupId(10L)).thenReturn(Optional.empty());
    }

    @Test
    void readingExplicitContextNeverTouchesPreferences() {
        var context = service.getContext(user, 1L);
        assertThat(context.currentGroup().id()).isEqualTo(1L);
        assertThat(context.accessibleGroups()).extracting(ProjectGroupContextItem::id).containsExactly(1L);
        assertThat(context.permissions()).contains("offline.write").doesNotContain("member.manage");
        verify(groupAccess, never()).findLastSelectedGroupId(any());
        verify(groupAccess, never()).recordGroupSelection(any(), any(), any());
    }

    @Test
    void choosingGroupRecordsPreferenceOnlyOnce() {
        assertThat(service.selectGroup(user, 1L).currentGroup().id()).isEqualTo(1L);
        verify(groupAccess).recordGroupSelection(eq(10L), eq(1L), any());
        verify(groupAccess).listActiveGroupsForUser(10L);
        verifyNoMoreInteractions(groupAccess);
    }

    @Test
    void disabledGroupIsHiddenFromSystemAdministratorWorkspace() {
        var admin = new AuthSession(20L, "admin", "Admin", "SYSTEM_ADMIN", user.expiresAt());
        assertThat(service.getContext(admin, 1L).accessibleGroups()).extracting(ProjectGroupContextItem::id).containsExactly(1L);
        verify(groupAccess, never()).findLastSelectedGroupId(any());
        verify(groupAccess, never()).recordGroupSelection(any(), any(), any());
    }

    @Test
    void selectingUnavailableGroupCannotUpdatePreference() {
        assertThatThrownBy(() -> service.selectGroup(user, 2L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(groupAccess, never()).recordGroupSelection(any(), any(), any());
    }

    @Test
    void removedLastMembershipRejectsExplicitGroupButAllowsNoGroupContext() {
        when(groupAccess.listActiveGroupsForUser(10L)).thenReturn(List.of());
        assertThat(service.getContext(user, null).currentGroup()).isNull();
        assertThatThrownBy(() -> service.getContext(user, 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(groupAccess, never()).findLastSelectedGroupId(any());
        verify(groupAccess, never()).recordGroupSelection(any(), any(), any());
    }

    @Test
    void defaultGroupIgnoresDisabledPreferenceWithoutWritingReplacement() {
        when(groupAccess.findLastSelectedGroupId(10L)).thenReturn(Optional.of(2L));
        assertThat(service.getContext(user, null).currentGroup().id()).isEqualTo(1L);
        verify(groupAccess).findLastSelectedGroupId(10L);
        verify(groupAccess, never()).recordGroupSelection(any(), any(), any());
    }
}
