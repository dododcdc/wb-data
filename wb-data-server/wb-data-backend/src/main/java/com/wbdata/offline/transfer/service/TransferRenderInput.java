package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.plugin.api.TableDetail;

import java.util.Map;

public record TransferRenderInput(
        TransferConfig transferConfig,
        DataSource sourceDataSource,
        DataSource targetDataSource,
        TableDetail sourceTableDetail,
        TableDetail targetTableDetail,
        Map<String, String> parameters
) {
}
