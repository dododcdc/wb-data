package com.wbdata.auth.service;

import com.wbdata.datasource.service.AuthorizedDataSourceService;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class AuthorizedDataSourceServiceTest {
    private final DataSourceService dataSources = mock(DataSourceService.class);
    private final AuthGroupAccessPort groupAccess = mock(AuthGroupAccessPort.class);
    private final AuthorizedDataSourceService service = new AuthorizedDataSourceService(dataSources,
            new GroupAuthorizationService(groupAccess, new PermissionService()));
    private final DataSource dataSource = new DataSource();

    @BeforeEach
    void setUp() {
        AuthContext.set(new AuthSession(10L, "member", "Member", "USER", Instant.now().plusSeconds(600)));
        dataSource.setId(20L);
        dataSource.setGroupId(2L);
        when(dataSources.getById(20L)).thenReturn(dataSource);
        when(groupAccess.findGroupAccess(2L, 10L, true)).thenReturn(Optional.of(
                new AuthGroupAccessPort.AuthGroupSnapshot(2L, "Group 2", "active", null)));
    }

    @AfterEach
    void cleanUp() {
        AuthContext.clear();
    }

    @Test
    void resourceInForeignGroupIsForbidden() {
        assertRejected(HttpStatus.FORBIDDEN, Permission.QUERY_USE);
    }

    @Test
    void disabledResourceGroupIsForbiddenEvenToAnExistingMember() {
        when(groupAccess.findGroupAccess(2L, 10L, true)).thenReturn(Optional.of(
                new AuthGroupAccessPort.AuthGroupSnapshot(2L, "Group 2", "disabled", "DEVELOPER")));
        assertRejected(HttpStatus.FORBIDDEN, Permission.QUERY_EXPORT);
    }

    @Test
    void actualResourceGroupAndPermissionAreChecked() {
        allowMember();
        assertThat(service.requireDataSource(20L, Permission.QUERY_USE)).isSameAs(dataSource);
        assertRejected(HttpStatus.FORBIDDEN, Permission.DATASOURCE_WRITE);
        verify(groupAccess, times(2)).findGroupAccess(2L, 10L, true);
    }

    @Test
    void deletedOrUnscopedDataSourceIsNotFound() {
        when(dataSources.getById(20L)).thenReturn(null);
        assertRejected(HttpStatus.NOT_FOUND, Permission.QUERY_USE);
        when(dataSources.getById(20L)).thenReturn(dataSource);
        dataSource.setGroupId(null);
        assertRejected(HttpStatus.NOT_FOUND, Permission.QUERY_USE);
        verifyNoInteractions(groupAccess);
    }

    @Test
    void anonymousCallIsRejectedBeforeReadingResources() {
        AuthContext.clear();
        assertRejected(HttpStatus.UNAUTHORIZED, Permission.QUERY_USE);
        verifyNoInteractions(dataSources, groupAccess);
    }

    private void allowMember() {
        when(groupAccess.findGroupAccess(2L, 10L, true)).thenReturn(Optional.of(
                new AuthGroupAccessPort.AuthGroupSnapshot(2L, "Group 2", "active", "DEVELOPER")));
    }

    private void assertRejected(HttpStatus status, Permission permission) {
        assertThatThrownBy(() -> service.requireDataSource(20L, permission))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(status));
    }

    @Test
    void requireEnabledDataSourceRejectsDisabledDataSourceAndAllowsEnabledOrUnset() {
        allowMember();
        assertThat(service.requireEnabledDataSource(20L, Permission.QUERY_USE)).isSameAs(dataSource);

        dataSource.setStatus("ENABLED");
        assertThat(service.requireEnabledDataSource(20L, Permission.QUERY_USE)).isSameAs(dataSource);

        dataSource.setStatus("DISABLED");
        assertThatThrownBy(() -> service.requireEnabledDataSource(20L, Permission.QUERY_USE))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void requireEnabledDataSourceChecksGroupPermissionBeforeStatus() {
        dataSource.setStatus("DISABLED");
        assertThatThrownBy(() -> service.requireEnabledDataSource(20L, Permission.QUERY_USE))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
    }
}
