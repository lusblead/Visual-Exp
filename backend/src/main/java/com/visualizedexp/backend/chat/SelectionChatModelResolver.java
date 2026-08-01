package com.visualizedexp.backend.chat;

import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.provider.ApiFormat;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderService;
import org.springframework.stereotype.Component;

@Component
public final class SelectionChatModelResolver {
    public static final String LOCAL_DEEPSEEK_MODEL = "deepseek-v4-pro";

    private final ProviderService providers;
    private final LocalDeepSeekCompanionClient companion;

    public SelectionChatModelResolver(
        ProviderService providers,
        LocalDeepSeekCompanionClient companion
    ) {
        this.providers = providers;
        this.companion = companion;
    }

    public ResolvedModel require(String ownerId) {
        return providers.findActive(ownerId, ProviderKind.MODEL)
            .map(ResolvedModel::persisted)
            .orElseGet(() -> {
                if (companion.isCredentialConfigured()) {
                    return ResolvedModel.fromLocalCompanion();
                }
                throw new ApiException(
                    "provider_not_configured",
                    "请先保存本机 DeepSeek API Key，或配置并启用一个 AI 模型供应商。",
                    409,
                    false
                );
            });
    }

    public record ResolvedModel(
        ProviderService.PlainProvider persistedProvider,
        boolean localCompanion
    ) {
        public static ResolvedModel persisted(
            ProviderService.PlainProvider provider
        ) {
            return new ResolvedModel(provider, false);
        }

        public static ResolvedModel fromLocalCompanion() {
            return new ResolvedModel(null, true);
        }

        public String providerConfigId() {
            return localCompanion ? null : persistedProvider.id();
        }

        public String defaultModel() {
            return localCompanion
                ? LOCAL_DEEPSEEK_MODEL
                : persistedProvider.defaultModel();
        }

        public ApiFormat apiFormat() {
            return localCompanion
                ? ApiFormat.OPENAI_CHAT_COMPLETIONS
                : persistedProvider.apiFormat();
        }
    }
}
