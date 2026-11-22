package com.wbdata.offline.credential.controller;

import com.wbdata.offline.credential.dto.DataSourceCredentialRequest;
import com.wbdata.offline.credential.dto.DataSourceCredentialResponse;
import com.wbdata.offline.credential.dto.GitCredentialRequest;
import com.wbdata.offline.credential.dto.GitCredentialResponse;
import com.wbdata.offline.credential.service.InternalCredentialService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/internal/offline/credentials")
@RequiredArgsConstructor
public class InternalCredentialController {

    static final String INTERNAL_TOKEN_HEADER = "X-WB-Data-Internal-Token";

    private final InternalCredentialService internalCredentialService;

    @PostMapping(value = "/datasource",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<DataSourceCredentialResponse> resolveDataSource(
            @RequestHeader(value = INTERNAL_TOKEN_HEADER, required = false) String internalToken,
            @Valid @RequestBody DataSourceCredentialRequest request) {
        return ResponseEntity.ok(internalCredentialService.resolveDataSource(internalToken, request));
    }

    @PostMapping(value = "/git",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<GitCredentialResponse> resolveGit(
            @RequestHeader(value = INTERNAL_TOKEN_HEADER, required = false) String internalToken,
            @Valid @RequestBody GitCredentialRequest request) {
        return ResponseEntity.ok(internalCredentialService.resolveGit(internalToken, request));
    }
}
