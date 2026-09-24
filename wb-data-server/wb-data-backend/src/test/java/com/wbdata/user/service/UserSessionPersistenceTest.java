package com.wbdata.user.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.wbdata.auth.service.AuthTokenService;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.user.dto.GroupAssignment;
import com.wbdata.user.dto.ResetPasswordRequest;
import com.wbdata.user.dto.UpdateUserRequest;
import com.wbdata.user.dto.UpdateUserStatusRequest;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@EnabledIfEnvironmentVariable(named = "WB_DATA_AUTH_TEST_DB_URL", matches = ".+")
class UserSessionPersistenceTest {
    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbc;
    private WbUserMapper mapper;
    private AuthTokenService tokens;
    private UserService users;
    private WbProjectGroupMemberMapper members;

    @BeforeEach
    void setUp() throws Exception {
        dataSource = new SingleConnectionDataSource(
                System.getenv("WB_DATA_AUTH_TEST_DB_URL"),
                System.getenv("WB_DATA_AUTH_TEST_DB_USER"),
                System.getenv("WB_DATA_AUTH_TEST_DB_PASSWORD"), true);
        jdbc = new JdbcTemplate(dataSource);
        // A connection-local temporary table shadows wb_user without changing persisted accounts.
        jdbc.execute("""
                CREATE TEMPORARY TABLE wb_user (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(64), password_hash VARCHAR(255),
                    display_name VARCHAR(64), system_role VARCHAR(32), status VARCHAR(32),
                    last_login_at DATETIME, created_by BIGINT, updated_by BIGINT,
                    created_at DATETIME, updated_at DATETIME
                ) ENGINE=InnoDB
                """);
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V20__add_user_auth_version.sql"))
                .execute(dataSource);
        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.setMapUnderscoreToCamelCase(true);
        configuration.addMapper(WbUserMapper.class);
        MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        factory.setConfiguration(configuration);
        mapper = new SqlSessionTemplate(factory.getObject()).getMapper(WbUserMapper.class);
        tokens = new AuthTokenService(mapper);
        members = mock(WbProjectGroupMemberMapper.class);
        UserService target = new UserService(mapper, mock(WbProjectGroupMapper.class), members,
                new BCryptPasswordEncoder());
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        TransactionInterceptor interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(new DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        proxy.addAdvice(interceptor);
        users = (UserService) proxy.getProxy();
        jdbc.update("INSERT INTO wb_user(id, username, password_hash, system_role, status) VALUES (1, 'test', 'old-hash', 'SYSTEM_ADMIN', 'ACTIVE')");
    }

    @AfterEach
    void tearDown() {
        if (dataSource != null) dataSource.destroy();
    }

    @Test
    void migrationAndPasswordResetRevokeSessionsWithoutResettingVersionOnPartialUpdates() {
        WbUser snapshot = mapper.selectById(1L);
        assertThat(snapshot.getAuthVersion()).isZero();
        String token = tokens.issueToken(snapshot).accessToken();
        ResetPasswordRequest req = new ResetPasswordRequest();
        req.setNewPassword("new-test-password");
        users.resetPassword(1L, req, 2L);

        assertThat(mapper.selectById(1L).getAuthVersion()).isEqualTo(1L);
        assertThat(new BCryptPasswordEncoder().matches("new-test-password", mapper.selectById(1L).getPasswordHash())).isTrue();
        assertThat(tokens.resolveToken(token)).isNull();
        assertThat(tokens.resolveToken(tokens.issueToken(snapshot).accessToken())).isNull();
        String currentToken = tokens.issueToken(mapper.selectById(1L)).accessToken();
        UpdateUserRequest rename = new UpdateUserRequest();
        rename.setDisplayName("Renamed");
        users.updateUser(1L, rename, 2L);
        assertThat(mapper.selectById(1L).getAuthVersion()).isEqualTo(1L);
        assertThat(tokens.resolveToken(currentToken)).isNotNull();
    }

    @Test
    void disablingAndReenablingCannotReviveOldSessions() {
        String token = tokens.issueToken(mapper.selectById(1L)).accessToken();
        UpdateUserStatusRequest req = new UpdateUserStatusRequest();
        req.setStatus("DISABLED");
        users.changeStatus(1L, req, 2L);
        req.setStatus("ACTIVE");
        users.changeStatus(1L, req, 2L);

        assertThat(mapper.selectById(1L).getAuthVersion()).isEqualTo(2L);
        assertThat(tokens.resolveToken(token)).isNull();
    }

    @Test
    void demotionRevokesAdministratorSession() {
        String token = tokens.issueToken(mapper.selectById(1L)).accessToken();
        UpdateUserRequest req = new UpdateUserRequest();
        req.setSystemRole("USER");
        users.updateUser(1L, req, 2L);

        assertThat(tokens.resolveToken(token)).isNull();
        assertThat(tokens.resolveToken(tokens.issueToken(mapper.selectById(1L)).accessToken()).isSystemAdmin()).isFalse();
    }

    @Test
    void failedUpdateRollsBackRoleAndVersionTogether() {
        String token = tokens.issueToken(mapper.selectById(1L)).accessToken();
        UpdateUserRequest req = new UpdateUserRequest();
        req.setSystemRole("USER");
        req.setGroupAssignments(List.<GroupAssignment>of());
        when(members.selectList(any())).thenThrow(new IllegalStateException("membership failure"));

        assertThatThrownBy(() -> users.updateUser(1L, req, 2L)).isInstanceOf(IllegalStateException.class);

        assertThat(mapper.selectById(1L).getSystemRole()).isEqualTo("SYSTEM_ADMIN");
        assertThat(mapper.selectById(1L).getAuthVersion()).isZero();
        assertThat(tokens.resolveToken(token)).isNotNull();
    }
}
