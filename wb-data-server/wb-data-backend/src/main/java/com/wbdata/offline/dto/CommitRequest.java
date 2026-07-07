package com.wbdata.offline.dto;

public record CommitRequest(
        Long groupId,
        String message
) {}
