package com.wbdata.auth.service;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AuthorizedDataSourceServiceTest {
    private final DataSourceService dataSources = mock(DataSourceService.class);
    private final WbProjectGroupMapper groups = mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper members = mock(WbProjectGroupMemberMapper.class);
    private final AuthorizedDataSourceService service = new AuthorizedDataSourceService(dataSources,
            new GroupAuthorizationService(groups, members, new PermissionService()));
    private final DataSource dataSource = new DataSource();
    private final WbProjectGroup group = new WbProjectGroup();

    @BeforeEach
    void setUp() {
        AuthContext.set(new AuthSession(10L, "member", "Member", "USER", Instant.now().plusSeconds(600)));
        group.setId(2L);
        dataSource.setId(20L);
        dataSource.setGroupId(2L);
        when(dataSources.getById(20L)).thenReturn(dataSource);
        when(groups.selectById(2L)).thenReturn(group);
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
        allowMember();
        group.setStatus("disabled");
        assertRejected(HttpStatus.FORBIDDEN, Permission.QUERY_EXPORT);
    }

    @Test
    void actualResourceGroupAndPermissionAreChecked() {
        allowMember();
        assertThat(service.requireDataSource(20L, Permission.QUERY_USE)).isSameAs(dataSource);
        assertRejected(HttpStatus.FORBIDDEN, Permission.DATASOURCE_WRITE);
        verify(groups, times(2)).selectById(2L);
    }

    @Test
    void deletedOrUnscopedDataSourceIsNotFound() {
        when(dataSources.getById(20L)).thenReturn(null);
        assertRejected(HttpStatus.NOT_FOUND, Permission.QUERY_USE);
        when(dataSources.getById(20L)).thenReturn(dataSource);
        dataSource.setGroupId(null);
        assertRejected(HttpStatus.NOT_FOUND, Permission.QUERY_USE);
        verifyNoInteractions(groups, members);
    }

    @Test
    void anonymousCallIsRejectedBeforeReadingResources() {
        AuthContext.clear();
        assertRejected(HttpStatus.UNAUTHORIZED, Permission.QUERY_USE);
        verifyNoInteractions(dataSources, groups, members);
    }

    private void allowMember() {
        var member = new WbProjectGroupMember();
        member.setUserId(10L);
        member.setGroupId(2L);
        member.setRole("DEVELOPER");
        when(members.selectOne(any())).thenReturn(member);
    }

    private void assertRejected(HttpStatus status, Permission permission) {
        assertThatThrownBy(() -> service.requireDataSource(20L, permission))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(status));
    }
}
