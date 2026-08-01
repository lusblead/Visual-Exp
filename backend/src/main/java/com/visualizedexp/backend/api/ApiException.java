package com.visualizedexp.backend.api;

public final class ApiException extends RuntimeException {
    private final String code;
    private final int status;
    private final boolean retryable;

    public ApiException(String code, String message, int status, boolean retryable) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public int status() {
        return status;
    }

    public boolean retryable() {
        return retryable;
    }
}
