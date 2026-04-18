package com.wbdata.offline.dto;

public record CommitResponse(
        boolean success,
        String message
) {}
