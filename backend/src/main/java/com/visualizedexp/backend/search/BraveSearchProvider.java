package com.visualizedexp.backend.search;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.ProviderVerifier;
import com.visualizedexp.backend.provider.SafeHttpClient;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@Component
public final class BraveSearchProvider implements SearchProvider {
    private final SafeHttpClient http;
    private final ObjectMapper objectMapper;

    public BraveSearchProvider(
        SafeHttpClient http,
        ObjectMapper objectMapper
    ) {
        this.http = http;
        this.objectMapper = objectMapper;
    }

    @Override
    public ProviderType type() {
        return ProviderType.BRAVE;
    }

    @Override
    public List<SearchCandidate> search(
        ProviderService.PlainProvider provider,
        SearchQuery query
    ) {
        String encoded = URLEncoder.encode(query.query(), StandardCharsets.UTF_8);
        String freshness = switch (query.freshness()) {
            case "day" -> "&freshness=pd";
            case "week" -> "&freshness=pw";
            case "month" -> "&freshness=pm";
            case "year" -> "&freshness=py";
            default -> "";
        };
        URI uri = URI.create(provider.baseUrl()
            + "/res/v1/web/search?q="
            + encoded
            + "&count="
            + query.maxResults()
            + freshness);
        SafeHttpClient.Response response = http.send(
            HttpRequest.newBuilder(uri)
                .header("Accept", MediaType.APPLICATION_JSON_VALUE)
                .header("X-Subscription-Token", provider.apiKey())
                .GET(),
            false
        );
        if (response.status() < 200 || response.status() >= 300) {
            throw ProviderVerifier.classify(response.status());
        }
        ProviderVerifier.rejectCredentialEcho(response.body(), provider.apiKey());
        try {
            JsonNode items = objectMapper.readTree(response.body())
                .path("web")
                .path("results");
            if (!items.isArray()) {
                throw ProviderVerifier.invalidResponse();
            }
            List<SearchCandidate> candidates = new ArrayList<>();
            for (JsonNode item : items) {
                candidates.add(new SearchCandidate(
                    item.path("title").asText(""),
                    item.path("url").asText(""),
                    item.path("description").asText(""),
                    item.path("page_age").asText("")
                ));
            }
            return candidates;
        } catch (JsonProcessingException | NullPointerException exception) {
            throw ProviderVerifier.invalidResponse();
        }
    }
}
