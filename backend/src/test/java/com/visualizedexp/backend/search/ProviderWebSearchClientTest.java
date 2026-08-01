package com.visualizedexp.backend.search;

import com.visualizedexp.backend.provider.AuthType;
import com.visualizedexp.backend.provider.EndpointMode;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.ProviderUrlPolicy;
import com.visualizedexp.backend.provider.UpstreamException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProviderWebSearchClientTest {
    @Test
    void dispatchesByActiveProviderAndAppliesCommonResultSafetyRules() {
        ProviderService providers = mock(ProviderService.class);
        SearchProvider tavily = providerAdapter(ProviderType.TAVILY);
        SearchProvider brave = providerAdapter(ProviderType.BRAVE);
        ProviderService.PlainProvider tavilyConfig = tavilyProvider();
        ProviderService.PlainProvider braveConfig = braveProvider();
        when(providers.requireActive("owner-t", ProviderKind.SEARCH))
            .thenReturn(tavilyConfig);
        when(providers.requireActive("owner-b", ProviderKind.SEARCH))
            .thenReturn(braveConfig);
        when(tavily.search(
            eq(tavilyConfig),
            org.mockito.ArgumentMatchers.any(SearchProvider.SearchQuery.class)
        )).thenReturn(List.of(
            candidate(
                "Official release",
                "https://example.test/release",
                "Current release details",
                "2026-07-30"
            ),
            candidate(
                "Duplicate",
                "https://example.test/release",
                "Duplicate URL",
                null
            ),
            candidate(
                "Insecure",
                "http://example.test/insecure",
                "Must be discarded",
                null
            ),
            candidate(
                "",
                "https://example.test/missing-title",
                "Must be discarded",
                null
            )
        ));
        when(brave.search(
            eq(braveConfig),
            org.mockito.ArgumentMatchers.any(SearchProvider.SearchQuery.class)
        )).thenReturn(List.of(candidate(
            "Brave result",
            "https://example.test/brave",
            "Brave details",
            null
        )));
        ProviderWebSearchClient client = client(
            providers,
            new SearchProviderRegistry(List.of(tavily, brave))
        );

        assertThat(client.search(
            "owner-t",
            " current release ",
            50,
            "week"
        )).containsExactly(new SearchSource(
            "Official release",
            "https://example.test/release",
            "Current release details",
            "2026-07-30"
        ));
        assertThat(client.search(
            "owner-b",
            "other release",
            2,
            "any"
        )).containsExactly(new SearchSource(
            "Brave result",
            "https://example.test/brave",
            "Brave details",
            null
        ));

        verify(tavily).search(
            eq(tavilyConfig),
            argThat(query ->
                "current release".equals(query.query())
                    && query.maxResults() == 5
                    && "week".equals(query.freshness())
            )
        );
        verify(brave).search(
            eq(braveConfig),
            argThat(query ->
                "other release".equals(query.query())
                    && query.maxResults() == 2
                    && "any".equals(query.freshness())
            )
        );
    }

    @Test
    void failsClosedWhenTheActiveProviderHasNoRegisteredAdapter() {
        ProviderService providers = mock(ProviderService.class);
        when(providers.requireActive("owner-a", ProviderKind.SEARCH))
            .thenReturn(braveProvider());
        SearchProvider tavily = providerAdapter(ProviderType.TAVILY);
        ProviderWebSearchClient client = client(
            providers,
            new SearchProviderRegistry(List.of(tavily))
        );

        assertThatThrownBy(() -> client.search(
            "owner-a",
            "current release",
            5,
            "any"
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("search_provider_unsupported"));
    }

    @Test
    void resolvedSessionPinsTheExecutedProviderAndItsAuditIdAcrossActivationChanges() {
        ProviderService providers = mock(ProviderService.class);
        SearchProvider tavily = providerAdapter(ProviderType.TAVILY);
        SearchProvider brave = providerAdapter(ProviderType.BRAVE);
        ProviderService.PlainProvider tavilyConfig = tavilyProvider();
        ProviderService.PlainProvider braveConfig = braveProvider();
        AtomicReference<ProviderService.PlainProvider> active =
            new AtomicReference<>(tavilyConfig);
        when(providers.findActive("owner-a", ProviderKind.SEARCH))
            .thenAnswer(invocation -> Optional.of(active.get()));
        when(tavily.search(
            eq(tavilyConfig),
            org.mockito.ArgumentMatchers.any(SearchProvider.SearchQuery.class)
        )).thenReturn(List.of(candidate(
            "Pinned result",
            "https://example.test/pinned",
            "Executed with the original snapshot",
            null
        )));
        ProviderWebSearchClient client = client(
            providers,
            new SearchProviderRegistry(List.of(tavily, brave))
        );

        WebSearchClient.SearchSession session = client.findActive("owner-a")
            .orElseThrow();
        active.set(braveConfig);
        List<SearchSource> results = session.search(
            "current release",
            5,
            "any"
        );

        assertThat(session.providerConfigId()).isEqualTo(tavilyConfig.id());
        assertThat(results).extracting(SearchSource::url)
            .containsExactly("https://example.test/pinned");
        verify(tavily).search(
            eq(tavilyConfig),
            org.mockito.ArgumentMatchers.any(SearchProvider.SearchQuery.class)
        );
        verify(brave, never()).search(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any()
        );
    }

    private static ProviderWebSearchClient client(
        ProviderService providers,
        SearchProviderRegistry registry
    ) {
        return new ProviderWebSearchClient(
            providers,
            new ProviderUrlPolicy(false),
            registry
        );
    }

    private static SearchProvider providerAdapter(ProviderType type) {
        SearchProvider provider = mock(SearchProvider.class);
        when(provider.type()).thenReturn(type);
        return provider;
    }

    private static SearchProvider.SearchCandidate candidate(
        String title,
        String url,
        String snippet,
        String publishedAt
    ) {
        return new SearchProvider.SearchCandidate(
            title,
            url,
            snippet,
            publishedAt
        );
    }

    private static ProviderService.PlainProvider tavilyProvider() {
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

    private static ProviderService.PlainProvider braveProvider() {
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
