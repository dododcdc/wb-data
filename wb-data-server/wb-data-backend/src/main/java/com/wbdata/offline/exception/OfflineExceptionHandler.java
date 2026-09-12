package com.wbdata.offline.exception;

import com.wbdata.common.Result;
import com.wbdata.offline.dto.DirtyWorkingTreeResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * offline 域异常的专属处理；全局兜底见 common/GlobalExceptionHandler。
 */
@RestControllerAdvice
public class OfflineExceptionHandler {

    @ExceptionHandler(DirtyWorkingTreeException.class)
    public ResponseEntity<Result<DirtyWorkingTreeResponse>> handleDirtyWorkingTreeException(DirtyWorkingTreeException ex) {
        return ResponseEntity
                .status(ex.getStatusCode())
                .body(Result.error(ex.getStatusCode().value(), ex.getReason(), ex.details()));
    }
}
