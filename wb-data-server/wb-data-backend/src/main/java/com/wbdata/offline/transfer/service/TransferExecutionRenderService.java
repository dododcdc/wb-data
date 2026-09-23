package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.plugin.api.TableDetail;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class TransferExecutionRenderService {

    private final TransferExecutionGuard guard;
    private final TransferMetadataService metadataService;
    private final TransferSeatunnelConfigBuilder configBuilder;

    public String render(String internalToken, TransferRenderRequest request, Map<String, String> parameters) {
        TransferExecutionGuard.DataSources dataSources = guard.validate(internalToken, request);
        TransferConfig config = request.transferConfig();
        try {
            TransferParameters.requireValues(config, parameters);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
        DataSource source = dataSources.source();
        DataSource target = dataSources.target();
        requireHiveTargetMetastore(target);

        TableDetail sourceTable = metadataService.getTableDetail(source, config.source().database(), config.source().table());
        TableDetail targetTable = metadataService.getTableDetail(target, config.target().database(), config.target().table());
        return configBuilder.build(new TransferRenderInput(config, source, target, sourceTable, targetTable, parameters));
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
