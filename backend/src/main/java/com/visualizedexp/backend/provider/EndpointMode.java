package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;

import java.util.Locale;

public enum EndpointMode {
    BASE_URL("base_url"),
    FULL_URL("full_url");

    private final String wireName;

    EndpointMode(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static EndpointMode parse(String value) {
        if (value != null) {
            String normalized = value.toLowerCase(Locale.ROOT);
            for (EndpointMode mode : values()) {
                if (mode.wireName.equals(normalized)) {
                    return mode;
                }
            }
        }
        throw new ApiException("validation_error", "endpointMode 不受支持。", 400, false);
    }
}
