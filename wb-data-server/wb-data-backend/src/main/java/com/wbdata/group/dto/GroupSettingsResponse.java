package com.wbdata.group.dto;

import com.wbdata.group.entity.WbProjectGroup;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class GroupSettingsResponse {

    private Long id;
    private String name;
    private String description;
    private LocalDateTime createdAt;

    public static GroupSettingsResponse from(WbProjectGroup group) {
        GroupSettingsResponse resp = new GroupSettingsResponse();
        resp.setId(group.getId());
        resp.setName(group.getName());
        resp.setDescription(group.getDescription());
        resp.setCreatedAt(group.getCreatedAt());
        return resp;
    }
}
