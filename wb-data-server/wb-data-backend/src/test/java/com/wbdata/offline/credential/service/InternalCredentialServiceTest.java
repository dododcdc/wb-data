package com.wbdata.offline.credential.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.credential.dto.DataSourceCredentialRequest;
import com.wbdata.offline.credential.dto.DataSourceCredentialResponse;
import com.wbdata.offline.credential.dto.GitCredentialRequest;
import com.wbdata.offline.credential.dto.GitCredentialResponse;
import com.wbdata.offline.repo.service.OfflineGitRemotePort;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InternalCredentialServiceTest {

    private static final String TOKEN = "internal-secret-token";

    private TransferInternalProperties internalProperties;
    private OfflineTransferProperties transferProperties;
    private DataSourceService dataSourceService;
    private OfflineGitRemotePort gitRemotePort;
    private InternalCredentialService service;

    @BeforeEach
    void setUp() {
        internalProperties = new TransferInternalProperties();
        internalProperties.setInternalToken(TOKEN);
        transferProperties = new OfflineTransferProperties();
        transferProperties.setContainerHostRewrite("host.docker.internal");
        dataSourceService = mock(DataSourceService.class);
        gitRemotePort = mock(OfflineGitRemotePort.class);
        service = new InternalCredentialService(internalProperties, transferProperties, dataSourceService, gitRemotePort);
    }

    @Test
    void resolveDataSource_supportsAllJdbcAndHiveTypesWithHostRewrite() {
        DataSource mysql = dataSource(1L, 4L, "MYSQL", "localhost", 3306, "warehouse", "u1", "p1");
        DataSource pg = dataSource(2L, 4L, "postgresql", "127.0.0.1", 5432, "analytics", "u2", "p2");
        DataSource ck = dataSource(3L, 4L, "CLICKHOUSE", "ck.internal", 8123, "default", "u3", "p3");
        DataSource hive = dataSource(4L, 4L, "HIVE", "::1", 10000, "dw", "hive", "");
        when(dataSourceService.getById(1L)).thenReturn(mysql);
        when(dataSourceService.getById(2L)).thenReturn(pg);
        when(dataSourceService.getById(3L)).thenReturn(ck);
        when(dataSourceService.getById(4L)).thenReturn(hive);

        DataSourceCredentialResponse r1 = service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 1L, "MYSQL"));
        DataSourceCredentialResponse r2 = service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 2L, "POSTGRESQL"));
        DataSourceCredentialResponse r3 = service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 3L, null));
        DataSourceCredentialResponse r4 = service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 4L, "HIVE"));

        assertThat(r1).isEqualTo(new DataSourceCredentialResponse(1L, "MYSQL", "jdbc:mysql://host.docker.internal:3306/warehouse", "u1", "p1"));
        assertThat(r2).isEqualTo(new DataSourceCredentialResponse(2L, "POSTGRESQL", "jdbc:postgresql://host.docker.internal:5432/analytics", "u2", "p2"));
        assertThat(r3).isEqualTo(new DataSourceCredentialResponse(3L, "CLICKHOUSE", "jdbc:clickhouse://ck.internal:8123/default", "u3", "p3"));
        assertThat(r4).isEqualTo(new DataSourceCredentialResponse(4L, "HIVE", "jdbc:hive2://host.docker.internal:10000/dw", "hive", ""));
    }

    @Test
    void resolveDataSource_rejectsUnauthorizedToken() {
        assertThatThrownBy(() -> service.resolveDataSource(null, new DataSourceCredentialRequest(4L, 1L, "MYSQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        assertThatThrownBy(() -> service.resolveDataSource("wrong", new DataSourceCredentialRequest(4L, 1L, "MYSQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        internalProperties.setInternalToken("  ");
        assertThatThrownBy(() -> service.resolveDataSource("any", new DataSourceCredentialRequest(4L, 1L, "MYSQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void resolveDataSource_rejectsMissingCrossGroupDisabledUnsupportedAndTypeMismatch() {
        when(dataSourceService.getById(99L)).thenReturn(null);
        assertThatThrownBy(() -> service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 99L, "MYSQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        DataSource otherGroup = dataSource(1L, 99L, "MYSQL", "db.example", 3306, "dw", "u", "p");
        when(dataSourceService.getById(1L)).thenReturn(otherGroup);
        assertThatThrownBy(() -> service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 1L, "MYSQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        DataSource disabled = dataSource(2L, 4L, "MYSQL", "db.example", 3306, "dw", "u", "p");
        disabled.setStatus("DISABLED");
        when(dataSourceService.getById(2L)).thenReturn(disabled);
        assertThatThrownBy(() -> service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 2L, "MYSQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        DataSource oracle = dataSource(3L, 4L, "ORACLE", "db.example", 1521, "orcl", "u", "p");
        when(dataSourceService.getById(3L)).thenReturn(oracle);
        assertThatThrownBy(() -> service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 3L, null)))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        DataSource mysql = dataSource(4L, 4L, "MYSQL", "db.example", 3306, "dw", "u", "p");
        when(dataSourceService.getById(4L)).thenReturn(mysql);
        assertThatThrownBy(() -> service.resolveDataSource(TOKEN, new DataSourceCredentialRequest(4L, 4L, "POSTGRESQL")))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void resolveGit_returnsDecryptedRepositoryUrlUsernameAndToken() {
        when(gitRemotePort.requireRuntimeCredentials(4L)).thenReturn(new OfflineGitRemotePort.GitRuntimeCredentials(
                "github",
                "https://github.com/alice/wb-data-4.git",
                "alice",
                "ghp_plain_decrypted"
        ));

        GitCredentialResponse response = service.resolveGit(TOKEN, new GitCredentialRequest(4L));

        assertThat(response).isEqualTo(new GitCredentialResponse(
                4L,
                "github",
                "https://github.com/alice/wb-data-4.git",
                "alice",
                "ghp_plain_decrypted"
        ));
    }

    private DataSource dataSource(Long id, Long groupId, String type, String host, Integer port,
                                  String db, String username, String password) {
        DataSource ds = new DataSource();
        ds.setId(id);
        ds.setGroupId(groupId);
        ds.setType(type);
        ds.setHost(host);
        ds.setPort(port);
        ds.setDatabaseName(db);
        ds.setUsername(username);
        ds.setPassword(password);
        ds.setStatus("ENABLED");
        return ds;
    }
}
