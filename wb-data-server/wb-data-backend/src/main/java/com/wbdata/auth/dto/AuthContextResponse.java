package com.wbdata.auth.dto;

import java.util.List;

public record AuthContextResponse(
        CurrentUserResponse user,
        boolean systemAdmin,
        ProjectGroupContextItem currentGroup,
        List<ProjectGroupContextItem> accessibleGroups,
        List<String> permissions
) {
}
