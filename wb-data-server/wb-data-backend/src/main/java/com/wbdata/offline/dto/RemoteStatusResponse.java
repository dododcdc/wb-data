package com.wbdata.offline.dto;

public record RemoteStatusResponse(
    boolean hasRemote,
    String remoteUrl
) {}
