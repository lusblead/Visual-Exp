package com.visualizedexp.backend.provider;

public final class UpstreamException extends RuntimeException {
    private final String code;
    private final int status;
    private final boolean retryable;
    private final boolean ambiguous;

    public UpstreamException(
        String code,
        String message,
        int status,
        boolean retryable,
        boolean ambiguous
    ) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.ambiguous = ambiguous;
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

    public boolean ambiguous() {
        return ambiguous;
    }
}
