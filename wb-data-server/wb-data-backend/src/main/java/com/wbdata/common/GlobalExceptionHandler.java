package com.wbdata.common;

import com.wbdata.plugin.api.DataSourceException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.stream.Collectors;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> handleIllegalArgument(IllegalArgumentException ex) {
        return Result.error(HttpStatus.BAD_REQUEST.value(), ex.getMessage());
    }

    @ExceptionHandler(DataSourceException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> handleDataSourceException(DataSourceException ex) {
        return Result.error(HttpStatus.INTERNAL_SERVER_ERROR.value(), ex.getMessage());
    }

    @ExceptionHandler(BusinessException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> handleBusinessException(BusinessException ex) {
        return Result.error(HttpStatus.INTERNAL_SERVER_ERROR.value(), ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> handleValidationExceptions(MethodArgumentNotValidException ex) {
        String errorMessage = ex.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining(", "));
        return Result.error(HttpStatus.BAD_REQUEST.value(), "参数校验失败: " + errorMessage);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Result<Void>> handleResponseStatusException(ResponseStatusException ex) {
        String reason = ex.getReason();
        String message = (reason == null || reason.isBlank())
                ? ex.getStatusCode().toString()
                : reason;
        return ResponseEntity
                .status(ex.getStatusCode())
                .body(Result.error(ex.getStatusCode().value(), message));
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> handleAllExceptions(Exception ex) {
        log.error("Unhandled exception", ex);
        return Result.error(HttpStatus.INTERNAL_SERVER_ERROR.value(), "服务器内部错误");
    }
}
