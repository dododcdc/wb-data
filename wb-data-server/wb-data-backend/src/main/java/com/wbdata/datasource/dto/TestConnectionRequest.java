package com.wbdata.datasource.dto;

import lombok.Data;
import java.util.Map;

@Data
public class TestConnectionRequest {
    private String type;
    private String host;
    private Integer port;
    private String databaseName;
    private String username;
    private String password;
    private Map<String, Object> connectionParams;
}
