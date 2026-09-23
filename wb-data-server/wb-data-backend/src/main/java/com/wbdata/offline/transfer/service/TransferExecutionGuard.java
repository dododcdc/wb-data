package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class TransferExecutionGuard {

    private final TransferInternalProperties properties;
    private final TransferMetadataService metadataService;
    private final Validator validator;

    public DataSources validate(String providedToken, TransferRenderRequest request) {
        String configuredToken = properties.getInternalToken();
        if (configuredToken == null || configuredToken.isBlank() || providedToken == null
                || !MessageDigest.isEqual(configuredToken.getBytes(StandardCharsets.UTF_8), providedToken.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal transfer token is invalid");
        }
        validate(request);
        validate(request.transferConfig());
        DataSource source = requireDataSource(request.source().dataSourceId(), request.groupId(), request.source().dataSourceType());
        DataSource target = requireDataSource(request.target().dataSourceId(), request.groupId(), request.target().dataSourceType());
        return new DataSources(source, target);
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

    private DataSource requireDataSource(Long id, Long groupId, String configuredType) {
        DataSource dataSource = metadataService.requireSupportedDataSource(id);
        if (!groupId.equals(dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
        if (!dataSource.getType().equals(configuredType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "传输配置中的数据源类型不匹配");
        }
        return dataSource;
    }

    public record DataSources(DataSource source, DataSource target) {
    }
}
