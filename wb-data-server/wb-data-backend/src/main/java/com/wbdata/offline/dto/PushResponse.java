package com.wbdata.offline.dto;

public record PushResponse(
    boolean success,
    String message,
    String remoteUrl,
    boolean remoteCreated
) {}
