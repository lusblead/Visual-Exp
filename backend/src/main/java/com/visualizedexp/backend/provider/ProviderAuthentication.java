package com.visualizedexp.backend.provider;

import java.net.http.HttpRequest;

public final class ProviderAuthentication {
    public static final String ANTHROPIC_VERSION = "2023-06-01";

    private ProviderAuthentication() {
    }

    public static HttpRequest.Builder apply(
        HttpRequest.Builder builder,
        ProviderService.PlainProvider provider
    ) {
        String header = switch (provider.authType()) {
            case BEARER -> "Authorization";
            case X_API_KEY -> "x-api-key";
            case API_KEY -> "api-key";
            case CUSTOM_HEADER -> provider.authHeader();
        };
        String value = provider.authType() == AuthType.BEARER
            ? "Bearer " + provider.apiKey()
            : provider.apiKey();
        builder.header(header, value);
        if (provider.apiFormat() == ApiFormat.ANTHROPIC_MESSAGES) {
            builder.header("anthropic-version", ANTHROPIC_VERSION);
        }
        return builder;
    }
}
