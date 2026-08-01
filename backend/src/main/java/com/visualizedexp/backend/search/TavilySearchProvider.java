package com.visualizedexp.backend.search;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.ProviderUrlPolicy;
import com.visualizedexp.backend.provider.ProviderVerifier;
import com.visualizedexp.backend.provider.SafeHttpClient;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.net.http.HttpRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public final class TavilySearchProvider implements SearchProvider {
    private final SafeHttpClient http;
    private final ProviderUrlPolicy urlPolicy;
    private final ObjectMapper objectMapper;

    public TavilySearchProvider(
        SafeHttpClient http,
        ProviderUrlPolicy urlPolicy,
        ObjectMapper objectMapper
    ) {
        this.http = http;
        this.urlPolicy = urlPolicy;
        this.objectMapper = objectMapper;
    }

    @Override
    public ProviderType type() {
        return ProviderType.TAVILY;
    }

    @Override
    public List<SearchCandidate> search(
        ProviderService.PlainProvider provider,
        SearchQuery query
    ) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("query", query.query());
        body.put("max_results", query.maxResults());
        body.put("search_depth", "basic");
        body.put("include_answer", false);
        body.put("include_raw_content", false);
        if (!"any".equals(query.freshness())) {
            body.put("time_range", query.freshness());
        }
        SafeHttpClient.Response response = http.send(
            HttpRequest.newBuilder(
                    urlPolicy.endpoint(provider.baseUrl(), "/search")
                )
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .header("Authorization", "Bearer " + provider.apiKey())
                .POST(HttpRequest.BodyPublishers.ofString(json(body))),
            false
        );
        if (response.status() < 200 || response.status() >= 300) {
            throw ProviderVerifier.classify(response.status());
        }
        ProviderVerifier.rejectCredentialEcho(response.body(), provider.apiKey());
        try {
            JsonNode items = objectMapper.readTree(response.body()).path("results");
            if (!items.isArray()) {
                throw ProviderVerifier.invalidResponse();
            }
            List<SearchCandidate> candidates = new ArrayList<>();
            for (JsonNode item : items) {
                candidates.add(new SearchCandidate(
                    item.path("title").asText(""),
                    item.path("url").asText(""),
                    item.path("content").asText(""),
                    item.path("published_date").asText("")
                ));
            }
            return candidates;
        } catch (JsonProcessingException | NullPointerException exception) {
            throw ProviderVerifier.invalidResponse();
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException(
                "Unable to encode Tavily search request",
                impossible
            );
        }
    }
}
