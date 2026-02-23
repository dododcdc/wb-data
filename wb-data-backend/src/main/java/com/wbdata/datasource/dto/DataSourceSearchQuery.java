package com.wbdata.datasource.dto;

import lombok.Data;
import java.util.List;

@Data
public class DataSourceSearchQuery {
    private String keyword;
    private String type;
    private List<String> typeList;
    private String status;
    private String sortField;
    private String sortOrder = "desc";
    private Integer page = 1;
    private Integer size = 10;
}
