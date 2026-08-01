package com.visualizedexp.backend.search;

import java.util.List;

public final class InternalSearchDtos {
    private InternalSearchDtos() {
    }

    public record SearchRequest(
        String query,
        Integer maxResults,
        String freshness
    ) {
    }

    public record SearchResponse(List<SearchSource> sources) {
        public SearchResponse {
            sources = List.copyOf(sources);
        }
    }
}
