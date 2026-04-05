package com.wbdata.group.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class MemberResponse {

    private Long id;
    private Long userId;
    private String username;
    private String displayName;
    private String role;
    private LocalDateTime createdAt;
}
