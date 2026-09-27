package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import com.wbdata.offline.transfer.dto.TransferConfig;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;

public record SaveOfflineFlowNodeRequest(
        @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_]+$") String taskId,
        String scriptContent,
        @NotBlank String kind,
        String scriptPath,
        Long dataSourceId,
        String dataSourceType,
        @Valid TransferConfig transfer
) {
    public SaveOfflineFlowNodeRequest(String taskId, String scriptContent, String kind, String scriptPath,
                                      Long dataSourceId, String dataSourceType) {
        this(taskId, scriptContent, kind, scriptPath, dataSourceId, dataSourceType, null);
    }

    @AssertTrue(message = "Script nodes require scriptPath and scriptContent")
    public boolean isValidForNodeKind() {
        if ("TRANSFER".equalsIgnoreCase(kind)) {
            return true;
        }
        return scriptContent != null && scriptPath != null && !scriptPath.isBlank();
    }
}
