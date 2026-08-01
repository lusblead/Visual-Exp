package com.visualizedexp.backend.chat;

import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.provider.ApiFormat;
import com.visualizedexp.backend.provider.AuthType;
import com.visualizedexp.backend.provider.EndpointMode;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SelectionChatModelResolverTest {
    @Test
    void ownerScopedActiveProviderOverridesTheDeviceCompanion() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        ProviderService.PlainProvider override = modelProvider("owner-a-provider");
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(override));

        SelectionChatModelResolver.ResolvedModel resolved =
            new SelectionChatModelResolver(providers, companion).require("owner-a");

        assertThat(resolved.persistedProvider()).isSameAs(override);
        assertThat(resolved.localCompanion()).isFalse();
        assertThat(resolved.providerConfigId()).isEqualTo("owner-a-provider");
        verify(companion, never()).isCredentialConfigured();
    }

    @Test
    void anotherOwnerWithoutAnOverrideFallsBackToTheDeviceCompanion() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider("owner-a-provider")));
        when(providers.findActive("owner-b", ProviderKind.MODEL))
            .thenReturn(Optional.empty());
        when(companion.isCredentialConfigured()).thenReturn(true);
        SelectionChatModelResolver resolver = new SelectionChatModelResolver(
            providers,
            companion
        );

        SelectionChatModelResolver.ResolvedModel ownerA = resolver.require("owner-a");
        SelectionChatModelResolver.ResolvedModel ownerB = resolver.require("owner-b");

        assertThat(ownerA.providerConfigId()).isEqualTo("owner-a-provider");
        assertThat(ownerB.localCompanion()).isTrue();
        assertThat(ownerB.providerConfigId()).isNull();
        assertThat(ownerB.defaultModel()).isEqualTo("deepseek-v4-pro");
        verify(companion).isCredentialConfigured();
    }

    @Test
    void rejectsChatWhenNeitherAnOverrideNorACompanionCredentialExists() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.empty());
        when(companion.isCredentialConfigured()).thenReturn(false);

        assertThatThrownBy(
            () -> new SelectionChatModelResolver(providers, companion)
                .require("owner-a")
        )
            .isInstanceOf(ApiException.class)
            .satisfies(exception -> {
                ApiException api = (ApiException) exception;
                assertThat(api.code()).isEqualTo("provider_not_configured");
                assertThat(api.status()).isEqualTo(409);
            });
    }

    private static ProviderService.PlainProvider modelProvider(String id) {
        return new ProviderService.PlainProvider(
            id,
            ProviderKind.MODEL,
            ProviderType.OPENAI,
            "https://api.openai.com/v1",
            "gpt-test",
            "secret",
            ApiFormat.OPENAI_CHAT_COMPLETIONS,
            EndpointMode.BASE_URL,
            AuthType.BEARER,
            null
        );
    }
}
