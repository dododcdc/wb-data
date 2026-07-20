package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.plugin.api.TableDetail;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class TransferExecutionRenderService {

    private final TransferInternalProperties properties;
    private final TransferMetadataService metadataService;
    private final Validator validator;
    private final TransferSeatunnelConfigBuilder configBuilder = new TransferSeatunnelConfigBuilder();

    public String render(String internalToken, TransferRenderRequest request) {
        authenticate(internalToken);
        validate(request);

        TransferConfig config = request.transferConfig();
        validate(config);
        DataSource source = metadataService.requireSupportedDataSource(config.source().dataSourceId());
        DataSource target = metadataService.requireSupportedDataSource(config.target().dataSourceId());
        requireGroup(source, request.groupId());
        requireGroup(target, request.groupId());
        requireConfiguredType(source, config.source().dataSourceType());
        requireConfiguredType(target, config.target().dataSourceType());
        requireHiveTargetMetastore(target);

        TableDetail sourceTable = metadataService.getTableDetail(source, config.source().database(), config.source().table());
        TableDetail targetTable = metadataService.getTableDetail(target, config.target().database(), config.target().table());
        return configBuilder.build(new TransferRenderInput(config, source, target, sourceTable, targetTable));
    }

    private void authenticate(String providedToken) {
        String configuredToken = properties.getInternalToken();
        if (configuredToken == null || configuredToken.isBlank() || providedToken == null
                || !MessageDigest.isEqual(configuredToken.getBytes(StandardCharsets.UTF_8), providedToken.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal transfer token is invalid");
        }
    }

    private void validate(Object value) {
        var violations = validator.validate(value);
        if (!violations.isEmpty()) {
            String message = violations.stream()
                    .map(ConstraintViolation::getMessage)
                    .sorted()
                    .collect(Collectors.joining(", "));
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "参数校验失败: " + message);
        }
    }

    private void requireGroup(DataSource dataSource, Long groupId) {
        if (!groupId.equals(dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
    }

    private void requireConfiguredType(DataSource dataSource, String configuredType) {
        if (!dataSource.getType().equals(configuredType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "传输配置中的数据源类型不匹配");
        }
    }

    private void requireHiveTargetMetastore(DataSource target) {
        if (!"HIVE".equals(target.getType())) {
            return;
        }
        Object metastoreUri = target.getConnectionParams() == null
                ? null
                : target.getConnectionParams().get("metastoreUri");
        if (!(metastoreUri instanceof String uri) || uri.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Hive target data source requires connectionParams.metastoreUri"
            );
        }
    }
}
