package com.wbdata.plugin.api;

import java.util.List;

public record PageResult<T>(
    List<T> data,
    int total,
    int page,
    int size
) {}
