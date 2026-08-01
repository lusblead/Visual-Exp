package com.visualizedexp.backend.chat;

import com.visualizedexp.backend.search.SearchSource;

import java.util.List;

public interface SelectionChatModelClient {
    Completion complete(
        String ownerId,
        String question,
        String selectedText,
        List<HistoryTurn> history,
        SearchMode searchMode
    );

    default Completion complete(
        String ownerId,
        String question,
        String selectedText,
        List<HistoryTurn> history,
        SearchMode searchMode,
        SearchProgressRecorder progressRecorder
    ) {
        return complete(ownerId, question, selectedText, history, searchMode);
    }

    record HistoryTurn(String userText, String assistantText) {
    }

    record Completion(
        String text,
        String providerConfigId,
        List<SearchSource> sources,
        SearchExecution search
    ) {
    }

    record SearchExecution(
        SearchMode mode,
        SearchStatus status,
        String providerConfigId,
        int callCount
    ) {
    }

    @FunctionalInterface
    interface SearchProgressRecorder {
        void record(List<SearchSource> sources, SearchExecution search);
    }

    final class CompletionFailure extends RuntimeException {
        private final RuntimeException failure;
        private final List<SearchSource> sources;
        private final SearchExecution search;

        public CompletionFailure(
            RuntimeException failure,
            List<SearchSource> sources,
            SearchExecution search
        ) {
            super(failure.getMessage(), failure);
            this.failure = failure;
            this.sources = List.copyOf(sources);
            this.search = search;
        }

        public RuntimeException failure() {
            return failure;
        }

        public List<SearchSource> sources() {
            return sources;
        }

        public SearchExecution search() {
            return search;
        }
    }
}
