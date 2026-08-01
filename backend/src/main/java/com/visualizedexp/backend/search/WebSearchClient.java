package com.visualizedexp.backend.search;

import java.util.List;
import java.util.Optional;

public interface WebSearchClient {
    List<SearchSource> search(
        String ownerId,
        String query,
        int maxResults,
        String freshness
    );

    Optional<SearchSession> findActive(String ownerId);

    interface SearchSession {
        String providerConfigId();

        List<SearchSource> search(
            String query,
            int maxResults,
            String freshness
        );
    }
}
