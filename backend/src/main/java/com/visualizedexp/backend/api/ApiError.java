package com.visualizedexp.backend.api;

public record ApiError(
    String code,
    String message,
    boolean retryable,
    String requestId
) {
}
