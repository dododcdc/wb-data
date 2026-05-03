package com.wbdata.common.dto;

import com.baomidou.mybatisplus.core.metadata.IPage;
import lombok.Data;
import java.util.List;
import java.util.function.Function;

@Data
public class PageResult<T> {
    private List<T> records;
    private long total;
    private long size;
    private long current;
    private long pages;

    public static <T> PageResult<T> of(IPage<T> page) {
        PageResult<T> result = new PageResult<>();
        result.setRecords(page.getRecords());
        result.setTotal(page.getTotal());
        result.setSize(page.getSize());
        result.setCurrent(page.getCurrent());
        result.setPages(page.getPages());
        return result;
    }

    public <R> PageResult<R> convert(Function<? super T, R> mapper) {
        PageResult<R> result = new PageResult<>();
        result.setRecords(this.records.stream().map(mapper).toList());
        result.setTotal(this.total);
        result.setSize(this.size);
        result.setCurrent(this.current);
        result.setPages(this.pages);
        return result;
    }
}
