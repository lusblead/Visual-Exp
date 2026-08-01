package com.visualizedexp.backend.provider;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.search.SearchProvider;
import com.visualizedexp.backend.search.SearchProviderRegistry;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpRequest;
import java.util.Map;

@Component
public class ProviderVerifier {
    private final SafeHttpClient http;
    private final ProviderUrlPolicy urlPolicy;
    private final ObjectMapper objectMapper;
    private final SearchProviderRegistry searchProviders;

    public ProviderVerifier(
        SafeHttpClient http,
        ProviderUrlPolicy urlPolicy,
        ObjectMapper objectMapper,
        SearchProviderRegistry searchProviders
    ) {
        this.http = http;
        this.urlPolicy = urlPolicy;
        this.objectMapper = objectMapper;
        this.searchProviders = searchProviders;
    }

    public void verify(ProviderService.PlainProvider candidate) {
        if (candidate.kind() == ProviderKind.MODEL) {
            verifyModel(candidate);
        } else {
            verifySearch(candidate);
        }
    }

    private void verifyModel(ProviderService.PlainProvider candidate) {
        String address = urlPolicy.resolve(
            candidate.type(),
            candidate.baseUrl(),
            candidate.endpointMode(),
            candidate.apiFormat()
        );
        URI uri = urlPolicy.modelEndpoint(
            address,
            candidate.endpointMode(),
            candidate.apiFormat()
        );
        Map<String, Object> body = candidate.apiFormat()
            == ApiFormat.ANTHROPIC_MESSAGES
            ? Map.of(
                "model",
                candidate.defaultModel(),
                "max_tokens",
                1,
                "messages",
                java.util.List.of(Map.of(
                    "role",
                    "user",
                    "content",
                    "Reply with OK."
                ))
            )
            : Map.of(
                "model",
                candidate.defaultModel(),
                "max_tokens",
                1,
                "stream",
                false,
                "messages",
                java.util.List.of(Map.of(
                    "role",
                    "user",
                    "content",
                    "Reply with OK."
                ))
            );
        HttpRequest.Builder request = HttpRequest.newBuilder(uri)
            .header("Accept", MediaType.APPLICATION_JSON_VALUE)
            .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .POST(HttpRequest.BodyPublishers.ofString(json(body)));
        ProviderAuthentication.apply(request, candidate);
        SafeHttpClient.Response response = http.send(
            request,
            false
        );
        requireModelVerified(
            response,
            candidate.apiFormat(),
            candidate.apiKey()
        );
    }

    private void verifySearch(ProviderService.PlainProvider candidate) {
        urlPolicy.assertRuntimeSafe(candidate.type(), candidate.baseUrl());
        searchProviders.require(candidate.type()).search(
            candidate,
            new SearchProvider.SearchQuery(
                "credential verification",
                1,
                "any"
            )
        );
    }

    private void requireModelVerified(
        SafeHttpClient.Response response,
        ApiFormat apiFormat,
        String apiKey
    ) {
        JsonNode payload = requireJsonObject(response, apiKey);
        boolean valid = apiFormat == ApiFormat.ANTHROPIC_MESSAGES
            ? payload.path("content").isArray()
            : payload.path("choices").isArray()
                && payload.path("choices").path(0).path("message").isObject();
        if (!valid) {
            throw invalidResponse();
        }
    }

    private JsonNode requireJsonObject(
        SafeHttpClient.Response response,
        String apiKey
    ) {
        if (response.status() < 200 || response.status() >= 300) {
            throw classify(response.status());
        }
        rejectCredentialEcho(response.body(), apiKey);
        try {
            JsonNode payload = objectMapper.readTree(response.body());
            if (payload == null || !payload.isObject()) {
                throw invalidResponse();
            }
            return payload;
        } catch (JsonProcessingException exception) {
            throw invalidResponse();
        }
    }

    public static UpstreamException classify(int status) {
        if (status == 401 || status == 403) {
            return new UpstreamException(
                "credential_invalid",
                "API Key 无效或无权访问该供应商。",
                401,
                false,
                false
            );
        }
        if (status == 429) {
            return new UpstreamException(
                "provider_rate_limited",
                "供应商请求频率受限。",
                429,
                true,
                false
            );
        }
        if (status >= 500) {
            return new UpstreamException(
                "provider_unavailable",
                "供应商暂时不可用。",
                502,
                true,
                false
            );
        }
        return new UpstreamException(
            "provider_verification_failed",
            "供应商拒绝了候选配置。",
            400,
            false,
            false
        );
    }

    public static UpstreamException invalidResponse() {
        return new UpstreamException(
            "provider_response_invalid",
            "供应商返回了无法验证的响应。",
            502,
            false,
            false
        );
    }

    public static void rejectCredentialEcho(
        String responseBody,
        String apiKey
    ) {
        if (responseBody != null
            && apiKey != null
            && !apiKey.isEmpty()
            && responseBody.contains(apiKey)) {
            throw new UpstreamException(
                "provider_response_rejected",
                "供应商返回了不安全的响应。",
                502,
                false,
                false
            );
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException("Unable to encode provider verification request", impossible);
        }
    }
}
