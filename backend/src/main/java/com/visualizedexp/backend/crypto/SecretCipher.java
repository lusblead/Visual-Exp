package com.visualizedexp.backend.crypto;

import com.visualizedexp.backend.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

@Component
public final class SecretCipher {
    private static final String PREFIX = "v1.";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public SecretCipher(@Value("${app.crypto.master-key-base64}") String encodedKey) {
        byte[] decoded = decodeKey(encodedKey);
        if (decoded.length != 32) {
            throw new IllegalStateException(
                "APP_CREDENTIAL_MASTER_KEY must encode exactly 32 bytes"
            );
        }
        this.key = new SecretKeySpec(decoded, "AES");
        Arrays.fill(decoded, (byte) 0);
    }

    public String encrypt(String plaintext, String associatedData) {
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(associatedData.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] envelope = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, envelope, 0, iv.length);
            System.arraycopy(encrypted, 0, envelope, iv.length, encrypted.length);
            return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(envelope);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to encrypt provider credential", exception);
        }
    }

    public String decrypt(String envelope, String associatedData) {
        if (envelope == null || !envelope.startsWith(PREFIX)) {
            throw corrupt();
        }
        try {
            byte[] packed = Base64.getUrlDecoder().decode(envelope.substring(PREFIX.length()));
            if (packed.length <= IV_BYTES + 16) {
                throw corrupt();
            }
            byte[] iv = Arrays.copyOfRange(packed, 0, IV_BYTES);
            byte[] encrypted = Arrays.copyOfRange(packed, IV_BYTES, packed.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(associatedData.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException | GeneralSecurityException exception) {
            throw corrupt();
        }
    }

    private static byte[] decodeKey(String value) {
        if (value == null || value.isBlank()) {
            return new byte[0];
        }
        try {
            return Base64.getDecoder().decode(value.trim());
        } catch (IllegalArgumentException standardFailure) {
            try {
                return Base64.getUrlDecoder().decode(value.trim());
            } catch (IllegalArgumentException urlFailure) {
                return new byte[0];
            }
        }
    }

    private static ApiException corrupt() {
        return new ApiException(
            "credential_decryption_failed",
            "已保存的供应商凭据无法解密，请重新配置。",
            500,
            false
        );
    }
}
