package com.wbdata.offline.repo.dto;

public record RemoteStatusResponse(
    boolean hasRemote,
    String remoteUrl
) {}
