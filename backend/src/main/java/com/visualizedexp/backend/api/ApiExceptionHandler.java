package com.visualizedexp.backend.api;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import com.visualizedexp.backend.provider.UpstreamException;

import java.util.UUID;

@RestControllerAdvice
public final class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> handleApi(ApiException exception, HttpServletRequest request) {
        return ResponseEntity.status(exception.status())
            .body(error(exception.code(), exception.getMessage(), exception.retryable(), request));
    }

    @ExceptionHandler(UpstreamException.class)
    ResponseEntity<ApiError> handleUpstream(
        UpstreamException exception,
        HttpServletRequest request
    ) {
        return ResponseEntity.status(exception.status())
            .body(error(exception.code(), exception.getMessage(), exception.retryable(), request));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(
        MethodArgumentNotValidException exception,
        HttpServletRequest request
    ) {
        FieldError field = exception.getBindingResult().getFieldError();
        String message = field == null
            ? "请求参数无效。"
            : field.getField() + ": " + field.getDefaultMessage();
        return ResponseEntity.badRequest()
            .body(error("validation_error", message, false, request));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MissingRequestHeaderException.class})
    ResponseEntity<ApiError> handleMalformed(Exception exception, HttpServletRequest request) {
        return ResponseEntity.badRequest()
            .body(error("invalid_request", "请求格式无效。", false, request));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception, HttpServletRequest request) {
        String requestId = requestId(request);
        log.error("Unhandled backend failure, requestId={}", requestId, exception);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ApiError("internal_error", "服务暂时无法完成请求。", true, requestId));
    }

    private static ApiError error(
        String code,
        String message,
        boolean retryable,
        HttpServletRequest request
    ) {
        return new ApiError(code, message, retryable, requestId(request));
    }

    private static String requestId(HttpServletRequest request) {
        String candidate = request.getHeader("X-Request-Id");
        if (candidate != null && candidate.matches("[A-Za-z0-9._-]{1,80}")) {
            return candidate;
        }
        return UUID.randomUUID().toString();
    }
}
