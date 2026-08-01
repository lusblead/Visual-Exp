package com.visualizedexp.backend.search;

import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderUrlPolicy;
import com.visualizedexp.backend.provider.ProviderVerifier;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public final class ProviderWebSearchClient implements WebSearchClient {
    private final ProviderService providers;
    private final ProviderUrlPolicy urlPolicy;
    private final SearchProviderRegistry registry;

    public ProviderWebSearchClient(
        ProviderService providers,
        ProviderUrlPolicy urlPolicy,
        SearchProviderRegistry registry
    ) {
        this.providers = providers;
        this.urlPolicy = urlPolicy;
        this.registry = registry;
    }

    @Override
    public List<SearchSource> search(
        String ownerId,
        String query,
        int maxResults,
        String freshness
    ) {
        return session(providers.requireActive(ownerId, ProviderKind.SEARCH))
            .search(query, maxResults, freshness);
    }

    @Override
    public Optional<SearchSession> findActive(String ownerId) {
        return providers.findActive(ownerId, ProviderKind.SEARCH)
            .map(this::session);
    }

    private SearchSession session(ProviderService.PlainProvider provider) {
        urlPolicy.assertRuntimeSafe(provider.type(), provider.baseUrl());
        SearchProvider adapter = registry.require(provider.type());
        return new SearchSession() {
            @Override
            public String providerConfigId() {
                return provider.id();
            }

            @Override
            public List<SearchSource> search(
                String query,
                int maxResults,
                String freshness
            ) {
                return execute(provider, adapter, query, maxResults, freshness);
            }
        };
    }

    private static List<SearchSource> execute(
        ProviderService.PlainProvider provider,
        SearchProvider adapter,
        String query,
        int maxResults,
        String freshness
    ) {
        String boundedQuery = query == null ? "" : query.trim();
        if (boundedQuery.isEmpty() || boundedQuery.length() > 300) {
            throw new ApiException(
                "validation_error",
                "搜索词必须为 1 到 300 个字符。",
                400,
                false
            );
        }
        String boundedFreshness = switch (freshness == null ? "any" : freshness) {
            case "any", "day", "week", "month", "year" -> freshness == null
                ? "any"
                : freshness;
            default -> throw new ApiException(
                "validation_error",
                "freshness 不受支持。",
                400,
                false
            );
        };
        int boundedMax = Math.max(1, Math.min(maxResults, 5));
        SearchProvider.SearchQuery validated = new SearchProvider.SearchQuery(
            boundedQuery,
            boundedMax,
            boundedFreshness
        );
        List<SearchProvider.SearchCandidate> candidates = adapter.search(
            provider,
            validated
        );
        return normalize(candidates, boundedMax);
    }

    private static List<SearchSource> normalize(
        List<SearchProvider.SearchCandidate> candidates,
        int limit
    ) {
        if (candidates == null) {
            throw ProviderVerifier.invalidResponse();
        }
        Map<String, SearchSource> unique = new LinkedHashMap<>();
        for (SearchProvider.SearchCandidate candidate : candidates) {
            if (unique.size() >= limit) {
                break;
            }
            if (candidate == null) {
                continue;
            }
            String title = bounded(candidate.title(), 300);
            String url = safeUrl(candidate.url());
            if (title.isBlank() || url == null || unique.containsKey(url)) {
                continue;
            }
            String snippet = bounded(candidate.snippet(), 600);
            String publishedAt = bounded(candidate.publishedAt(), 80);
            unique.put(
                url,
                new SearchSource(
                    title,
                    url,
                    snippet,
                    publishedAt.isBlank() ? null : publishedAt
                )
            );
        }
        return new ArrayList<>(unique.values());
    }

    private static String safeUrl(String value) {
        if (value == null || value.length() > 2048) {
            return null;
        }
        try {
            URI uri = URI.create(value);
            if (uri.getHost() == null
                || !"https".equalsIgnoreCase(uri.getScheme())) {
                return null;
            }
            return uri.toString();
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private static String bounded(String value, int max) {
        String normalized = value == null ? "" : value.trim();
        return normalized.length() <= max
            ? normalized
            : normalized.substring(0, max);
    }
}
