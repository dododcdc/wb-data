package com.wbdata.offline.credential.dto;

public record DataSourceCredentialResponse(
        Long dataSourceId,
        String type,
        String url,
        String username,
        String password
) {
}
