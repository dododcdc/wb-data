package com.wbdata.ownership.dto;

import java.util.List;

public record UserAssetHandoverResponse(
        Long fromUserId,
        int totalTransferred,
        List<GroupAssetHandoverResponse> results
) {
}
