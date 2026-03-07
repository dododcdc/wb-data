package com.wbdata.query.service;

import com.wbdata.plugin.api.TableMetadata;
import java.util.List;

public interface MetadataService {
    List<TableMetadata> getTables(Long dataSourceId);
}
