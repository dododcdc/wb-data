package com.wbdata.offline.transfer.controller;

import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.offline.transfer.service.TransferExecutionRenderService;
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

    @PostMapping(value = "/render", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> render(
            @RequestHeader(value = INTERNAL_TOKEN_HEADER, required = false) String internalToken,
            @Valid @RequestBody TransferRenderRequest request) {
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_PLAIN)
                .body(renderService.render(internalToken, request));
    }
}
