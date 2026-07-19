package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.plugin.api.TableDetail;

public record TransferRenderInput(
        TransferConfig transferConfig,
        DataSource sourceDataSource,
        DataSource targetDataSource,
        TableDetail targetTableDetail
) {
}
