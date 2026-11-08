package com.wbdata.offline.dto;

import java.time.LocalDateTime;

public record OfflineFlowPublicationItem(
        Long publishRecordId,
        Integer onlineVersion,
        String afterSha,
        LocalDateTime pushedAt,
        String status,
        boolean currentOnline
) {
}
