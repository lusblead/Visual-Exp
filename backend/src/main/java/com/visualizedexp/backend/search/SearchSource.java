package com.visualizedexp.backend.search;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record SearchSource(
    String title,
    String url,
    String snippet,
    String publishedAt
) {
}
