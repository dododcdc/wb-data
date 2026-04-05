package com.wbdata.group.dto;

import com.wbdata.user.entity.WbUser;
import lombok.Data;

@Data
public class AvailableUserResponse {

    private Long id;
    private String username;
    private String displayName;

    public static AvailableUserResponse from(WbUser user) {
        AvailableUserResponse resp = new AvailableUserResponse();
        resp.setId(user.getId());
        resp.setUsername(user.getUsername());
        resp.setDisplayName(user.getDisplayName());
        return resp;
    }
}
