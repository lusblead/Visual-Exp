package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.UnknownHostException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProviderUrlPolicyTest {
    private final ProviderUrlPolicy policy = new ProviderUrlPolicy(false);

    @Test
    void rejectsCustomLoopbackAndSearchPresetOverrides() {
        assertThatThrownBy(() -> policy.resolve(
            ProviderType.CUSTOM_OPENAI_COMPATIBLE,
            "https://127.0.0.1:8443/v1"
        )).isInstanceOf(ApiException.class);

        assertThatThrownBy(() -> policy.resolve(
            ProviderType.TAVILY,
            "https://example.test/v1"
        )).isInstanceOf(ApiException.class);

        assertThatThrownBy(() -> policy.resolve(
            ProviderType.CUSTOM_OPENAI_COMPATIBLE,
            "https://100.64.0.1/v1"
        )).isInstanceOf(ApiException.class);

        assertThatThrownBy(() -> policy.resolve(
            ProviderType.CUSTOM_OPENAI_COMPATIBLE,
            "https://198.18.0.1/v1"
        )).isInstanceOf(ApiException.class);
    }

    @Test
    void derivesExactProtocolEndpointsAndAllowsModelPresetOverrides() {
        ProviderUrlPolicy permissiveDns = new ProviderUrlPolicy(true);
        assertThat(permissiveDns.resolve(
            ProviderType.OPENAI,
            "https://gateway.example.test/openai/v1",
            EndpointMode.BASE_URL,
            ApiFormat.OPENAI_CHAT_COMPLETIONS
        )).isEqualTo("https://gateway.example.test/openai/v1");

        assertThat(policy.modelEndpoint(
            "https://api.openai.com/v1",
            EndpointMode.BASE_URL,
            ApiFormat.OPENAI_CHAT_COMPLETIONS
        )).hasToString("https://api.openai.com/v1/chat/completions");
        assertThat(policy.modelEndpoint(
            "https://api.anthropic.com",
            EndpointMode.BASE_URL,
            ApiFormat.ANTHROPIC_MESSAGES
        )).hasToString("https://api.anthropic.com/v1/messages");
        assertThat(policy.modelEndpoint(
            "https://gateway.example.test/v1",
            EndpointMode.BASE_URL,
            ApiFormat.ANTHROPIC_MESSAGES
        )).hasToString("https://gateway.example.test/v1/messages");
        assertThat(policy.modelEndpoint(
            "https://gateway.example.test/exact/messages",
            EndpointMode.FULL_URL,
            ApiFormat.ANTHROPIC_MESSAGES
        )).hasToString("https://gateway.example.test/exact/messages");
    }

    @Test
    void appliesTheSameAddressPolicyDuringConnectionResolution() throws Exception {
        assertThatThrownBy(() -> policy.resolveConnectionAddresses("127.0.0.1"))
            .isInstanceOf(UnknownHostException.class);

        assertThat(
            new ProviderUrlPolicy(true)
                .resolveConnectionAddresses("127.0.0.1")
        ).allMatch(address -> address.isLoopbackAddress());
    }

    @Test
    void allowsClashFakeIpOnlyForExactBuiltInOfficialHosts() throws Exception {
        InetAddress fakeIp = InetAddress.getByAddress(new byte[] {
            (byte) 198,
            18,
            0,
            48
        });
        InetAddress loopback = InetAddress.getByAddress(new byte[] {
            127,
            0,
            0,
            1
        });

        assertThatCode(() -> policy.assertResolvedAddressesSafe(
            "api.tavily.com",
            new InetAddress[] {fakeIp}
        )).doesNotThrowAnyException();
        assertThatThrownBy(() -> policy.assertResolvedAddressesSafe(
            "custom.example.com",
            new InetAddress[] {fakeIp}
        )).isInstanceOf(UnknownHostException.class);
        assertThatThrownBy(() -> policy.assertResolvedAddressesSafe(
            "api.tavily.com",
            new InetAddress[] {loopback}
        )).isInstanceOf(UnknownHostException.class);
    }
}
