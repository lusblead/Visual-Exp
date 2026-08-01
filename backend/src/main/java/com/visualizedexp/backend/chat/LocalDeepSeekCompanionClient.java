package com.visualizedexp.backend.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.provider.ProviderVerifier;
import com.visualizedexp.backend.provider.UpstreamException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.SocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

@Component
public final class LocalDeepSeekCompanionClient {
    private static final int MAX_REQUEST_BYTES = 1_048_576;
    private static final int MAX_RESPONSE_BYTES = 2 * 1_048_576;
    private static final String STATUS_PATH = "/v1/status";
    private static final String CHAT_PATH = "/v1/deepseek/chat/completions";

    private final boolean enabled;
    private final URI origin;
    private final String bearerToken;
    private final Duration requestTimeout;
    private final HttpClient http;
    private final ObjectMapper objectMapper;

    public LocalDeepSeekCompanionClient(
        @Value("${app.local-companion.enabled:false}") boolean enabled,
        @Value("${app.local-companion.origin:}") String origin,
        @Value("${app.local-companion.token:}") String bearerToken,
        @Value("${app.providers.connect-timeout:10s}") Duration connectTimeout,
        @Value("${app.providers.request-timeout:45s}") Duration requestTimeout,
        ObjectMapper objectMapper
    ) {
        this.enabled = enabled;
        this.origin = enabled ? requireLoopbackOrigin(origin) : null;
        this.bearerToken = enabled ? requireBearerToken(bearerToken) : null;
        this.requestTimeout = requestTimeout;
        this.objectMapper = objectMapper;
        this.http = HttpClient.newBuilder()
            .connectTimeout(connectTimeout)
            .followRedirects(HttpClient.Redirect.NEVER)
            .proxy(DirectProxySelector.INSTANCE)
            .build();
    }

    public boolean isCredentialConfigured() {
        if (!enabled) {
            return false;
        }
        LocalResponse response = request(STATUS_PATH, null, false);
        if (response.status() < 200 || response.status() >= 300) {
            throw classify(response, false);
        }
        JsonNode root = jsonObject(response.body());
        if (!root.path("configured").isBoolean()
            || !"deepseek".equals(root.path("provider").asText())
            || !"deepseek-v4-pro".equals(root.path("model").asText())
            || !"windows_credential_manager".equals(root.path("storage").asText())) {
            throw ProviderVerifier.invalidResponse();
        }
        return root.path("configured").booleanValue();
    }

    public String sendChat(String requestBody) {
        if (!enabled) {
            throw providerNotConfigured();
        }
        byte[] encoded = requestBody.getBytes(StandardCharsets.UTF_8);
        if (encoded.length > MAX_REQUEST_BYTES) {
            throw new ApiException(
                "validation_error",
                "模型请求超过安全上限。",
                413,
                false
            );
        }
        LocalResponse response = request(CHAT_PATH, encoded, true);
        if (response.status() < 200 || response.status() >= 300) {
            throw classify(response, true);
        }
        return response.body();
    }

    @Override
    public String toString() {
        return "LocalDeepSeekCompanionClient[enabled=" + enabled + "]";
    }

    private LocalResponse request(
        String path,
        byte[] body,
        boolean ambiguousOnTransport
    ) {
        HttpRequest.Builder request = HttpRequest.newBuilder(origin.resolve(path))
            .timeout(requestTimeout)
            .header("Accept", "application/json")
            .header("Authorization", "Bearer " + bearerToken);
        if (body == null) {
            request.GET();
        } else {
            request.header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
        }

        try {
            HttpResponse<InputStream> response = http.send(
                request.build(),
                HttpResponse.BodyHandlers.ofInputStream()
            );
            try (InputStream input = response.body()) {
                byte[] bytes = input.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) {
                    throw new UpstreamException(
                        "provider_response_too_large",
                        "供应商响应超过安全上限。",
                        502,
                        false,
                        false
                    );
                }
                return new LocalResponse(
                    response.statusCode(),
                    new String(bytes, StandardCharsets.UTF_8)
                );
            }
        } catch (HttpTimeoutException exception) {
            throw new UpstreamException(
                "provider_timeout",
                "供应商请求超时。",
                504,
                true,
                ambiguousOnTransport
            );
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new UpstreamException(
                "provider_unavailable",
                "供应商请求被中断。",
                503,
                true,
                ambiguousOnTransport
            );
        } catch (IOException exception) {
            throw new UpstreamException(
                "provider_unavailable",
                "本机凭据服务暂时不可用。",
                503,
                true,
                ambiguousOnTransport
            );
        }
    }

    private RuntimeException classify(LocalResponse response, boolean ambiguous) {
        String code = safeErrorCode(response.body());
        return switch (code) {
            case "credential_required" -> providerNotConfigured();
            case "credential_invalid" -> new UpstreamException(
                "credential_invalid",
                "DeepSeek API Key 无效或无权访问该供应商。",
                401,
                false,
                false
            );
            case "provider_insufficient_balance" -> new UpstreamException(
                code,
                "DeepSeek 账户余额不足。",
                402,
                false,
                false
            );
            case "provider_rate_limited" -> new UpstreamException(
                code,
                "供应商请求频率受限。",
                429,
                true,
                false
            );
            case "provider_timeout" -> new UpstreamException(
                code,
                "供应商请求超时。",
                504,
                true,
                ambiguous
            );
            case "provider_unavailable", "provider_insufficient_resources" ->
                new UpstreamException(
                    code,
                    "供应商暂时不可用。",
                    502,
                    true,
                    false
                );
            case "provider_content_filtered", "provider_invalid_parameters",
                "provider_rejected", "model_not_allowed", "invalid_proxy_request" ->
                new UpstreamException(
                    code,
                    "供应商拒绝了模型请求。",
                    response.status(),
                    false,
                    false
                );
            case "unauthorized" -> new UpstreamException(
                "local_companion_unavailable",
                "本机凭据服务认证已失效，请重新启动本地模式。",
                503,
                true,
                false
            );
            default -> ProviderVerifier.classify(response.status());
        };
    }

    private String safeErrorCode(String body) {
        try {
            JsonNode code = objectMapper.readTree(body).path("error").path("code");
            if (code.isTextual()
                && code.textValue().matches("^[a-z][a-z0-9_]{0,79}$")) {
                return code.textValue();
            }
        } catch (JsonProcessingException ignored) {
            // Fall back to the status-only provider classifier.
        }
        return "";
    }

    private JsonNode jsonObject(String body) {
        try {
            JsonNode root = objectMapper.readTree(body);
            if (root == null || !root.isObject()) {
                throw ProviderVerifier.invalidResponse();
            }
            return root;
        } catch (JsonProcessingException exception) {
            throw ProviderVerifier.invalidResponse();
        }
    }

    private static URI requireLoopbackOrigin(String value) {
        URI candidate;
        try {
            candidate = URI.create(value == null ? "" : value.trim());
        } catch (IllegalArgumentException exception) {
            throw invalidConfiguration();
        }
        String path = candidate.getRawPath();
        if (!"http".equals(candidate.getScheme())
            || !"127.0.0.1".equals(candidate.getHost())
            || candidate.getPort() < 1
            || candidate.getPort() > 65_535
            || candidate.getRawUserInfo() != null
            || candidate.getRawQuery() != null
            || candidate.getRawFragment() != null
            || !(path == null || path.isEmpty() || "/".equals(path))) {
            throw invalidConfiguration();
        }
        return URI.create("http://127.0.0.1:" + candidate.getPort());
    }

    private static String requireBearerToken(String value) {
        String candidate = value == null ? "" : value.trim();
        if (candidate.length() < 16
            || candidate.length() > 4096
            || candidate.chars().anyMatch(character ->
                Character.isWhitespace(character)
                    || Character.isISOControl(character))) {
            throw invalidConfiguration();
        }
        return candidate;
    }

    private static IllegalStateException invalidConfiguration() {
        return new IllegalStateException(
            "Local companion configuration must use one fixed loopback origin."
        );
    }

    private static ApiException providerNotConfigured() {
        return new ApiException(
            "provider_not_configured",
            "请先保存本机 DeepSeek API Key，或配置并启用一个 AI 模型供应商。",
            409,
            false
        );
    }

    private record LocalResponse(int status, String body) {
    }

    private static final class DirectProxySelector extends ProxySelector {
        private static final DirectProxySelector INSTANCE = new DirectProxySelector();

        @Override
        public List<Proxy> select(URI uri) {
            return List.of(Proxy.NO_PROXY);
        }

        @Override
        public void connectFailed(
            URI uri,
            SocketAddress address,
            IOException exception
        ) {
            // There is no proxy to fail over to.
        }
    }
}
