package com.visualizedexp.backend.search;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.provider.AuthType;
import com.visualizedexp.backend.provider.EndpointMode;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.SafeHttpClient;
import com.visualizedexp.backend.provider.UpstreamException;
import org.junit.jupiter.api.Test;

import java.net.http.HttpRequest;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BraveSearchProviderTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void usesFixedGetContractAndMapsRawCandidates() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        AtomicReference<HttpRequest> captured = new AtomicReference<>();
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenAnswer(
            invocation -> {
                captured.set(((HttpRequest.Builder) invocation.getArgument(0)).build());
                return new SafeHttpClient.Response(
                    200,
                    """
                    {
                      "web": {
                        "results": [{
                          "title": "Release",
                          "url": "https://example.test/release",
                          "description": "Details",
                          "page_age": "2 hours ago"
                        }]
                      }
                    }
                    """
                );
            }
        );
        BraveSearchProvider adapter = new BraveSearchProvider(http, objectMapper);

        List<SearchProvider.SearchCandidate> candidates = adapter.search(
            provider(),
            new SearchProvider.SearchQuery("Java 21", 3, "week")
        );

        assertThat(candidates).containsExactly(
            new SearchProvider.SearchCandidate(
                "Release",
                "https://example.test/release",
                "Details",
                "2 hours ago"
            )
        );
        HttpRequest request = captured.get();
        assertThat(request.method()).isEqualTo("GET");
        assertThat(request.uri()).hasToString(
            "https://api.search.brave.com/res/v1/web/search"
                + "?q=Java+21&count=3&freshness=pw"
        );
        assertThat(request.headers().firstValue("X-Subscription-Token"))
            .contains("secret-b");
        assertThat(request.headers().firstValue("Authorization")).isEmpty();
    }

    @Test
    void rejectsMalformedAndCredentialFailureResponses() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenReturn(
            new SafeHttpClient.Response(
                200,
                "{\"web\":{\"results\":\"invalid\"}}"
            ),
            new SafeHttpClient.Response(401, "{}"),
            new SafeHttpClient.Response(
                200,
                "{\"web\":{\"results\":[{\"title\":\"secret-b\",\"url\":\"https://example.test\"}]}}"
            )
        );
        BraveSearchProvider adapter = new BraveSearchProvider(http, objectMapper);
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

    private static ProviderService.PlainProvider provider() {
        return new ProviderService.PlainProvider(
            "search-b",
            ProviderKind.SEARCH,
            ProviderType.BRAVE,
            "https://api.search.brave.com",
            null,
            "secret-b",
            null,
            EndpointMode.BASE_URL,
            AuthType.CUSTOM_HEADER,
            "X-Subscription-Token"
        );
    }
}
