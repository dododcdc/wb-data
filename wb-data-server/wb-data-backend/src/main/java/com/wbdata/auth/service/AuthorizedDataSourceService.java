package com.wbdata.auth.service;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class AuthorizedDataSourceService {
    private final DataSourceService dataSourceService;
    private final GroupAuthorizationService authorizationService;

    public DataSource requireDataSource(Long dataSourceId, Permission permission) {
        AuthSession session = AuthContext.require();
        DataSource dataSource = dataSourceService.getById(dataSourceId);
        if (dataSource == null || dataSource.getGroupId() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
        authorizationService.requireGroup(session, dataSource.getGroupId(), permission);
        return dataSource;
    }
}
