package com.visualizedexp.backend.search;

import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.UpstreamException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SearchProviderRegistryTest {
    @Test
    void returnsOnlyTheExactRegisteredProvider() {
        SearchProvider tavily = provider(ProviderType.TAVILY);
        SearchProvider brave = provider(ProviderType.BRAVE);
        SearchProviderRegistry registry =
            new SearchProviderRegistry(List.of(tavily, brave));

        assertThat(registry.require(ProviderType.TAVILY)).isSameAs(tavily);
        assertThat(registry.require(ProviderType.BRAVE)).isSameAs(brave);
    }

    @Test
    void rejectsDuplicateAndUnsupportedProvidersWithoutFallback() {
        SearchProvider first = provider(ProviderType.TAVILY);
        SearchProvider duplicate = provider(ProviderType.TAVILY);

        assertThatThrownBy(() ->
            new SearchProviderRegistry(List.of(first, duplicate))
        )
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Duplicate SearchProvider");

        SearchProviderRegistry registry =
            new SearchProviderRegistry(List.of(first));
        assertThatThrownBy(() -> registry.require(ProviderType.BRAVE))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("search_provider_unsupported"));
    }

    private static SearchProvider provider(ProviderType type) {
        SearchProvider provider = mock(SearchProvider.class);
        when(provider.type()).thenReturn(type);
        return provider;
    }
}
