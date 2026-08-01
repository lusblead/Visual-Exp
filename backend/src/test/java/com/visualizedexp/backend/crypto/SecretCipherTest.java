package com.visualizedexp.backend.crypto;

import com.visualizedexp.backend.api.ApiException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecretCipherTest {
    @Test
    void authenticatesCiphertextWithOwnerScopedAssociatedData() {
        SecretCipher cipher = new SecretCipher(
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        );
        String encrypted = cipher.encrypt("top-secret", "owner-a|config-a|OPENAI");

        assertThat(encrypted).startsWith("v1.").doesNotContain("top-secret");
        assertThat(cipher.decrypt(encrypted, "owner-a|config-a|OPENAI"))
            .isEqualTo("top-secret");
        assertThatThrownBy(() -> cipher.decrypt(
            encrypted,
            "owner-b|config-a|OPENAI"
        )).isInstanceOf(ApiException.class);
    }
}
