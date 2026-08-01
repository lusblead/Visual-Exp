package com.visualizedexp.backend.search;

import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;

import java.util.List;

/**
 * Provider-specific transport and response mapping behind the web-search tool.
 */
public interface SearchProvider {
    ProviderType type();

    List<SearchCandidate> search(
        ProviderService.PlainProvider provider,
        SearchQuery query
    );

    record SearchQuery(String query, int maxResults, String freshness) {
    }

    record SearchCandidate(
        String title,
        String url,
        String snippet,
        String publishedAt
    ) {
    }
}
