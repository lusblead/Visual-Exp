package com.visualizedexp.backend.search;

import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.auth.OwnerIdentity;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;

@RestController
public final class InternalSearchController {
    private static final int DEFAULT_MAX_RESULTS = 5;
    private static final Set<String> FRESHNESS = Set.of(
        "any",
        "day",
        "week",
        "month",
        "year"
    );

    private final WebSearchClient search;
    private final OwnerIdentity ownerIdentity;

    public InternalSearchController(
        WebSearchClient search,
        OwnerIdentity ownerIdentity
    ) {
        this.search = search;
        this.ownerIdentity = ownerIdentity;
    }

    @PostMapping("/internal/v1/search")
    InternalSearchDtos.SearchResponse search(
        @RequestBody InternalSearchDtos.SearchRequest body,
        HttpServletRequest request
    ) {
        if (body == null) {
            throw validation("请求体不能为空。");
        }
        String query = boundedQuery(body.query());
        int maxResults = boundedMaxResults(body.maxResults());
        String freshness = boundedFreshness(body.freshness());
        List<SearchSource> sources = search.search(
            ownerIdentity.require(request),
            query,
            maxResults,
            freshness
        );
        return new InternalSearchDtos.SearchResponse(
            sources.stream().limit(maxResults).toList()
        );
    }

    private static String boundedQuery(String value) {
        String query = value == null ? "" : value.trim();
        if (query.isEmpty() || query.length() > 300) {
            throw validation("query 必须为 1 到 300 个字符。");
        }
        return query;
    }

    private static int boundedMaxResults(Integer value) {
        int maxResults = value == null ? DEFAULT_MAX_RESULTS : value;
        if (maxResults < 1 || maxResults > DEFAULT_MAX_RESULTS) {
            throw validation("maxResults 必须为 1 到 5。");
        }
        return maxResults;
    }

    private static String boundedFreshness(String value) {
        String freshness = value == null ? "any" : value.trim();
        if (!FRESHNESS.contains(freshness)) {
            throw validation("freshness 不受支持。");
        }
        return freshness;
    }

    private static ApiException validation(String message) {
        return new ApiException(
            "validation_error",
            message,
            400,
            false
        );
    }
}
