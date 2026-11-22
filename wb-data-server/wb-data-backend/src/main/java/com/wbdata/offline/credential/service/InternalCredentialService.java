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
import com.wbdata.offline.transfer.service.JdbcDriverCatalog;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;

/**
 * 为 Kestra 运行时插件提供按需凭据解析（数据源连接信息与项目组 Git 凭据），
 * 避免在 Flow YAML 与同步 YAML 中落盘明文账号密码和 PAT。
 */
@Service
@RequiredArgsConstructor
public class InternalCredentialService {

    private static final Set<String> SUPPORTED_DATASOURCE_TYPES =
            Set.of("MYSQL", "POSTGRESQL", "CLICKHOUSE", "HIVE");

    private final TransferInternalProperties transferInternalProperties;
    private final OfflineTransferProperties offlineTransferProperties;
    private final DataSourceService dataSourceService;
    private final OfflineGitRemotePort gitRemotePort;

    public DataSourceCredentialResponse resolveDataSource(String providedToken,
                                                          DataSourceCredentialRequest request) {
        authorize(providedToken);
        DataSource dataSource = dataSourceService.getById(request.dataSourceId());
        if (dataSource == null || !request.groupId().equals(dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
        if ("DISABLED".equalsIgnoreCase(dataSource.getStatus())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "数据源已禁用");
        }
        String type = dataSource.getType() == null
                ? ""
                : dataSource.getType().trim().toUpperCase(Locale.ROOT);
        if (!SUPPORTED_DATASOURCE_TYPES.contains(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + dataSource.getType());
        }
        if (request.expectedType() != null && !request.expectedType().isBlank()
                && !request.expectedType().trim().equalsIgnoreCase(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "数据源类型不匹配");
        }

        JdbcDriverCatalog catalog = new JdbcDriverCatalog(offlineTransferProperties.getContainerHostRewrite());
        String jdbcUrl;
        try {
            jdbcUrl = catalog.resolve(dataSource, dataSource.getDatabaseName()).url();
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
        return new DataSourceCredentialResponse(
                dataSource.getId(),
                type,
                jdbcUrl,
                dataSource.getUsername(),
                dataSource.getPassword()
        );
    }

    public GitCredentialResponse resolveGit(String providedToken, GitCredentialRequest request) {
        authorize(providedToken);
        OfflineGitRemotePort.GitRuntimeCredentials creds =
                gitRemotePort.requireRuntimeCredentials(request.groupId());
        return new GitCredentialResponse(
                request.groupId(),
                creds.provider(),
                creds.repositoryUrl(),
                creds.username(),
                creds.token()
        );
    }

    private void authorize(String providedToken) {
        String configuredToken = transferInternalProperties.getInternalToken();
        if (configuredToken == null || configuredToken.isBlank() || providedToken == null
                || !MessageDigest.isEqual(
                        configuredToken.getBytes(StandardCharsets.UTF_8),
                        providedToken.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal credential token is invalid");
        }
    }
}
