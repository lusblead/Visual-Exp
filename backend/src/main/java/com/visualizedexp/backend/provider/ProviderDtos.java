package com.visualizedexp.backend.provider;

import java.util.List;

public final class ProviderDtos {
    private ProviderDtos() {
    }

    public record WriteRequest(
        String name,
        String kind,
        String provider,
        String apiKey,
        String baseUrl,
        String defaultModel,
        Boolean activate,
        String apiFormat,
        String endpointMode,
        String authType,
        String authHeader
    ) {
    }

    public record Summary(
        String id,
        String name,
        String kind,
        String provider,
        String baseUrl,
        String defaultModel,
        String apiFormat,
        String endpointMode,
        String authType,
        String authHeader,
        boolean configured,
        boolean active,
        String lastVerifiedAt,
        String createdAt,
        String updatedAt
    ) {
    }

    public record ListResponse(List<Summary> providers) {
    }

    public record WriteResponse(Summary provider) {
    }
}
