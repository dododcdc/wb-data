package com.wbdata.query.controller;

public record QueryRequest(
    String sql,
    String database
) {}
