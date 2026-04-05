package com.wbdata.auth.service;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.dto.AuthContextResponse;
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
    private final AuthContextService authContextService;

    public AuthContextResponse requireContext() {
        AuthSession session = AuthContext.require();
        return authContextService.getContext(session, null);
    }

    public DataSource requireDataSource(Long dataSourceId, String permission) {
        DataSource dataSource = dataSourceService.getById(dataSourceId);
        if (dataSource == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数据源不存在");
        }
        if (dataSource.getGroupId() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数据源尚未迁移到项目组模型");
        }

        AuthSession session = AuthContext.require();
        AuthContextResponse context = authContextService.getContext(session, dataSource.getGroupId());
        if (context.currentGroup() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前未选中项目组");
        }
        if (!context.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission);
        }

        return dataSource;
    }
}
