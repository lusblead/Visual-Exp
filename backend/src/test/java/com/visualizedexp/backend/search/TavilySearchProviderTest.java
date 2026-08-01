package com.visualizedexp.backend.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.provider.AuthType;
import com.visualizedexp.backend.provider.EndpointMode;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.ProviderUrlPolicy;
import com.visualizedexp.backend.provider.SafeHttpClient;
import com.visualizedexp.backend.provider.UpstreamException;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TavilySearchProviderTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void usesFixedPostContractAndMapsRawCandidates() throws Exception {
        SafeHttpClient http = mock(SafeHttpClient.class);
        AtomicReference<HttpRequest> captured = new AtomicReference<>();
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenAnswer(
            invocation -> {
                captured.set(((HttpRequest.Builder) invocation.getArgument(0)).build());
                return new SafeHttpClient.Response(
                    200,
                    """
                    {
                      "results": [{
                        "title": "Release",
                        "url": "https://example.test/release",
                        "content": "Details",
                        "published_date": "2026-07-30"
                      }]
                    }
                    """
                );
            }
        );
        TavilySearchProvider adapter = adapter(http);

        List<SearchProvider.SearchCandidate> candidates = adapter.search(
            provider(),
            new SearchProvider.SearchQuery("Java release", 3, "week")
        );

        assertThat(candidates).containsExactly(
            new SearchProvider.SearchCandidate(
                "Release",
                "https://example.test/release",
                "Details",
                "2026-07-30"
            )
        );
        HttpRequest request = captured.get();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.uri()).hasToString("https://api.tavily.com/search");
        assertThat(request.headers().firstValue("Authorization"))
            .contains("Bearer secret-t");
        JsonNode body = objectMapper.readTree(body(request));
        assertThat(body.path("query").asText()).isEqualTo("Java release");
        assertThat(body.path("max_results").asInt()).isEqualTo(3);
        assertThat(body.path("time_range").asText()).isEqualTo("week");
        assertThat(body.path("include_answer").asBoolean()).isFalse();
        assertThat(body.path("include_raw_content").asBoolean()).isFalse();
    }

    @Test
    void rejectsMalformedAndCredentialFailureResponses() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenReturn(
            new SafeHttpClient.Response(200, "{\"results\":\"invalid\"}"),
            new SafeHttpClient.Response(401, "{}"),
            new SafeHttpClient.Response(
                200,
                "{\"results\":[{\"title\":\"secret-t\",\"url\":\"https://example.test\"}]}"
            )
        );
        TavilySearchProvider adapter = adapter(http);
        SearchProvider.SearchQuery query =
            new SearchProvider.SearchQuery("Java", 1, "any");

        assertThatThrownBy(() -> adapter.search(provider(), query))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_response_invalid"));
        assertThatThrownBy(() -> adapter.search(provider(), query))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("credential_invalid"));
        assertThatThrownBy(() -> adapter.search(provider(), query))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_response_rejected"));
    }

    private TavilySearchProvider adapter(SafeHttpClient http) {
        return new TavilySearchProvider(
            http,
            new ProviderUrlPolicy(false),
            objectMapper
        );
    }

    private static String body(HttpRequest request) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        CompletableFuture<String> completed = new CompletableFuture<>();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<>() {
            @Override
            public void onSubscribe(Flow.Subscription subscription) {
                subscription.request(Long.MAX_VALUE);
            }

            @Override
            public void onNext(ByteBuffer item) {
                byte[] chunk = new byte[item.remaining()];
                item.get(chunk);
                output.writeBytes(chunk);
            }

            @Override
            public void onError(Throwable throwable) {
                completed.completeExceptionally(throwable);
            }

            @Override
            public void onComplete() {
                completed.complete(output.toString(StandardCharsets.UTF_8));
            }
        });
        return completed.join();
    }

    private static ProviderService.PlainProvider provider() {
        return new ProviderService.PlainProvider(
            "search-t",
            ProviderKind.SEARCH,
            ProviderType.TAVILY,
            "https://api.tavily.com",
            null,
            "secret-t",
            null,
            EndpointMode.BASE_URL,
            AuthType.BEARER,
            null
        );
    }
}
