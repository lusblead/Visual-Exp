package com.visualizedexp.backend.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InternalTokenFilterTest {
    @Test
    void permitsTokenlessLoopbackDevelopmentOnly() {
        assertThatCode(() -> new InternalTokenFilter(
            "",
            "127.0.0.1",
            new ObjectMapper()
        )).doesNotThrowAnyException();

        assertThatThrownBy(() -> new InternalTokenFilter(
            "",
            "0.0.0.0",
            new ObjectMapper()
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("APP_INTERNAL_TOKEN");
    }
}
