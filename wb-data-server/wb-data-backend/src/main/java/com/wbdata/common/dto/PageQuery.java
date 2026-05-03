package com.wbdata.common.dto;

import lombok.Data;

@Data
public class PageQuery {
    private int page = 1;
    private int size = 10;
    private String keyword;

    public <T> com.baomidou.mybatisplus.extension.plugins.pagination.Page<T> toMyBatisPage() {
        return new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(page, size);
    }
}
