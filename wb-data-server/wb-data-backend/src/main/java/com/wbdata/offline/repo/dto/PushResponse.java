package com.wbdata.offline.repo.dto;

public record PushResponse(
    boolean success,
    String message,
    String remoteUrl,
    boolean remoteCreated,
    boolean remoteDeleted
) {}
