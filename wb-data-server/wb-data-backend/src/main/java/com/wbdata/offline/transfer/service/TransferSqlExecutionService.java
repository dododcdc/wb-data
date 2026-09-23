package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.SqlExecutionException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class TransferSqlExecutionService {

    private final TransferExecutionGuard guard;
    private final DataSourcePluginRegistry pluginRegistry;
    private final TransferInternalProperties properties;

    public String executePreSql(String internalToken, TransferRenderRequest request, Map<String, String> parameters) {
        return execute(internalToken, request, parameters, true);
    }

    public String executePostSql(String internalToken, TransferRenderRequest request, Map<String, String> parameters) {
        return execute(internalToken, request, parameters, false);
    }

    private String execute(String internalToken, TransferRenderRequest request, Map<String, String> parameters,
                           boolean beforeTransfer) {
        DataSource target = guard.validate(internalToken, request).target();
        try {
            TransferParameters.requireValues(request.transferConfig(), parameters);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
        List<String> statements = beforeTransfer ? request.target().preSql() : request.target().postSql();
        if (statements == null || statements.isEmpty()) {
            return "";
        }
        DataSourcePlugin plugin = pluginRegistry.getPlugin(target.getType())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "未找到目标数据源插件"));
        String phase = beforeTransfer ? "前置 SQL" : "后置 SQL";
        try {
            plugin.executeStatements(new DataSourceConnectionInfo(
                    target.getId(), target.getType(), target.getHost(), target.getPort(),
                    request.target().database(), target.getUsername(), target.getPassword(), target.getConnectionParams()
            ), statements, parameters, properties.getSqlTimeoutSeconds());
        } catch (SqlExecutionException e) {
            String detail = e.getStatementIndex() == 0 ? "连接失败" : "第 " + e.getStatementIndex() + " 条执行失败";
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    phase + detail + (beforeTransfer ? "；传输未开始，已执行的 SQL 未回滚，请检查后重试"
                            : "；数据已写入，未回滚，请手动处理"));
        }
        return phase + "已执行 " + statements.size() + " 条\n";
    }
}
