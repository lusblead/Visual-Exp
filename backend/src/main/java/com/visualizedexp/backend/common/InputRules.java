package com.visualizedexp.backend.common;

import com.visualizedexp.backend.api.ApiException;

import java.util.regex.Pattern;

public final class InputRules {
    private static final Pattern EXTERNAL_ID = Pattern.compile("^[A-Za-z0-9_-]{1,120}$");
    private static final Pattern NODE_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,160}$");

    private InputRules() {
    }

    public static String externalId(String value, String field) {
        if (value == null || !EXTERNAL_ID.matcher(value).matches()) {
            throw new ApiException("validation_error", field + " 格式无效。", 400, false);
        }
        return value;
    }

    public static String nodeId(String value) {
        if (value == null || !NODE_ID.matcher(value).matches()) {
            throw new ApiException("validation_error", "selection.nodeId 格式无效。", 400, false);
        }
        return value;
    }

    public static String boundedText(String value, int max, String field) {
        if (value == null || value.isBlank() || value.length() > max) {
            throw new ApiException(
                "validation_error",
                field + " 必须为 1 到 " + max + " 个字符。",
                400,
                false
            );
        }
        return value.trim();
    }
}
