package com.wbdata.offline.transfer.controller;

import com.wbdata.offline.transfer.dto.TransferExecutionRequest;
import com.wbdata.offline.transfer.service.TransferExecutionRenderService;
import com.wbdata.offline.transfer.service.TransferSqlExecutionService;
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
@RequestMapping("/api/v1/internal/offline/transfer")
@RequiredArgsConstructor
public class InternalTransferController {

    static final String INTERNAL_TOKEN_HEADER = "X-WB-Data-Internal-Token";

    private final TransferExecutionRenderService renderService;
    private final TransferSqlExecutionService sqlExecutionService;

    @PostMapping(value = "/pre-sql", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> executePreSql(
            @RequestHeader(value = INTERNAL_TOKEN_HEADER, required = false) String internalToken,
            @Valid @RequestBody TransferExecutionRequest request) {
        return ResponseEntity.ok().contentType(MediaType.TEXT_PLAIN)
                .body(sqlExecutionService.executePreSql(internalToken, request.config(), request.parameters()));
    }

    @PostMapping(value = "/post-sql", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> executePostSql(
            @RequestHeader(value = INTERNAL_TOKEN_HEADER, required = false) String internalToken,
            @Valid @RequestBody TransferExecutionRequest request) {
        return ResponseEntity.ok().contentType(MediaType.TEXT_PLAIN)
                .body(sqlExecutionService.executePostSql(internalToken, request.config(), request.parameters()));
    }

    @PostMapping(value = "/render", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> render(
            @RequestHeader(value = INTERNAL_TOKEN_HEADER, required = false) String internalToken,
            @Valid @RequestBody TransferExecutionRequest request) {
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_PLAIN)
                .body(renderService.render(internalToken, request.config(), request.parameters()));
    }
}
