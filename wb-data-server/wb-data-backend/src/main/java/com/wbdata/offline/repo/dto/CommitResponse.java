package com.wbdata.offline.repo.dto;

public record CommitResponse(
        boolean success,
        String message
) {}
