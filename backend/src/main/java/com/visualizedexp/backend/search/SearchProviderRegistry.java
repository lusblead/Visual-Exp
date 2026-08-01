package com.visualizedexp.backend.search;

import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.UpstreamException;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

@Component
public final class SearchProviderRegistry {
    private final Map<ProviderType, SearchProvider> providers;

    public SearchProviderRegistry(List<SearchProvider> providers) {
        EnumMap<ProviderType, SearchProvider> registered =
            new EnumMap<>(ProviderType.class);
        for (SearchProvider provider : providers) {
            ProviderType type = provider.type();
            if (type == null || type.kind() != ProviderKind.SEARCH) {
                throw new IllegalStateException(
                    "SearchProvider must declare a search ProviderType"
                );
            }
            if (registered.putIfAbsent(type, provider) != null) {
                throw new IllegalStateException(
                    "Duplicate SearchProvider implementation for " + type.name()
                );
            }
        }
        this.providers = Map.copyOf(registered);
    }

    public SearchProvider require(ProviderType type) {
        SearchProvider provider = providers.get(type);
        if (provider == null) {
            throw new UpstreamException(
                "search_provider_unsupported",
                "当前搜索供应商没有可用适配器。",
                503,
                false,
                false
            );
        }
        return provider;
    }
}
