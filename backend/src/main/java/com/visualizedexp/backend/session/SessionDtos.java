package com.visualizedexp.backend.session;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

public final class SessionDtos {
    private SessionDtos() {
    }

    public record Summary(
        String id,
        String question,
        String title,
        String updatedAt
    ) {
    }

    public record RestoreResponse(
        JsonNode session,
        List<Summary> sessions,
        List<String> quarantinedIds
    ) {
    }

    public record ListResponse(List<Summary> sessions) {
    }

    public record ReadResponse(JsonNode session) {
    }

    public record SaveResponse(
        boolean saved,
        boolean stale,
        List<Summary> sessions
    ) {
    }
}
