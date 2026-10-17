package com.wbdata.offline.repo.dto;

public record CommitRequest(
        Long groupId,
        String message
) {}
