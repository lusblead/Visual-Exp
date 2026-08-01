package com.visualizedexp.backend.session;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.common.InputRules;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Component
public final class KnowledgeSessionValidator {
    public static final String PROTOCOL = "visual-knowledge-session/1";
    public static final int MAX_BYTES = 3_670_016;

    private static final Set<String> FORBIDDEN_FIELDS = Set.of(
        "apikey",
        "authorization",
        "bearer",
        "bearertoken",
        "companionbearer",
        "companiontoken",
        "hmacsecret",
        "signingsecret",
        "environmentsecret",
        "prompt",
        "providerbody",
        "requestbody",
        "responsebody",
        "pending",
        "controller",
        "abortcontroller"
    );
    private static final Set<String> DANGEROUS_FIELDS = Set.of(
        "__proto__",
        "constructor",
        "prototype"
    );
    private static final Set<String> TOP_LEVEL_KEYS = Set.of(
        "protocol",
        "id",
        "createdAt",
        "updatedAt",
        "revision",
        "document",
        "navigation",
        "termResults",
        "termCards",
        "visibleTermCardKeys",
        "deepResults",
        "activeDeepKey",
        "prefetchProfile",
        "usageReceipts"
    );
    private static final Set<String> DOCUMENT_KEYS = Set.of(
        "protocol",
        "id",
        "question",
        "title",
        "thesis",
        "rootId",
        "primaryMaterial",
        "nodes",
        "relations",
        "version"
    );
    private static final Set<String> DOCUMENT_REQUIRED_KEYS = Set.of(
        "protocol",
        "id",
        "question",
        "title",
        "thesis",
        "rootId",
        "nodes",
        "relations",
        "version"
    );
    private static final Set<String> NODE_KEYS = Set.of(
        "id",
        "parentId",
        "title",
        "eyebrow",
        "summary",
        "detail",
        "terms",
        "kind",
        "view",
        "depth",
        "childIds",
        "expandable",
        "expansionState",
        "emphasis",
        "confidence",
        "sourceStatus",
        "evidence"
    );
    private static final Set<String> NODE_REQUIRED_KEYS = Set.of(
        "id",
        "parentId",
        "title",
        "eyebrow",
        "summary",
        "detail",
        "kind",
        "view",
        "depth",
        "childIds",
        "expandable",
        "expansionState",
        "emphasis",
        "confidence",
        "sourceStatus",
        "evidence"
    );
    private static final Set<String> RELATION_KEYS = Set.of(
        "id",
        "scopeId",
        "from",
        "to",
        "kind",
        "label"
    );
    private static final Set<String> PROFILES = Set.of("on_demand", "balanced", "deep");

    private final ObjectMapper objectMapper;

    public KnowledgeSessionValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public ValidatedSession validate(String pathId, JsonNode session) {
        InputRules.externalId(pathId, "sessionId");
        if (session == null || !session.isObject()) {
            throw invalid("session 必须是 JSON 对象。");
        }
        exactKeys(session, TOP_LEVEL_KEYS, TOP_LEVEL_KEYS, "session");
        String id = requiredText(session, "id", 120);
        if (!pathId.equals(id)) {
            throw invalid("path sessionId 必须与 session.id 相同。");
        }
        if (!PROTOCOL.equals(requiredText(session, "protocol", 80))) {
            throw invalid("session.protocol 必须是 " + PROTOCOL + "。");
        }
        long revision = requiredPositiveLong(session, "revision");
        String createdAt = requiredInstant(session, "createdAt");
        String updatedAt = requiredInstant(session, "updatedAt");
        if (Instant.parse(updatedAt).isBefore(Instant.parse(createdAt))) {
            throw invalid("session.updatedAt 不得早于 createdAt。");
        }
        JsonNode document = session.get("document");
        if (document == null || !document.isObject()) {
            throw invalid("session.document 必须是对象。");
        }
        validateDocument(document);
        validateMainCollections(session);
        String title = requiredText(document, "title", 240);
        String question = requiredText(document, "question", 1200);
        inspectFields(session);

        try {
            String json = objectMapper.writeValueAsString(session);
            if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
                throw invalid("session 超过 3.5 MiB 持久化上限。");
            }
            return new ValidatedSession(
                id,
                revision,
                title,
                question,
                createdAt,
                updatedAt,
                json
            );
        } catch (JsonProcessingException exception) {
            throw invalid("session 不是有效的 JSON。");
        }
    }

    private static void validateDocument(JsonNode document) {
        exactKeys(document, DOCUMENT_KEYS, DOCUMENT_REQUIRED_KEYS, "session.document");
        if (!"visual-explanation-document/2".equals(requiredText(document, "protocol", 80))) {
            throw invalid("session.document.protocol 不受支持。");
        }
        requiredText(document, "id", 512);
        requiredText(document, "rootId", 512);
        requiredText(document, "thesis", 12_000);
        requiredPositiveLong(document, "version");

        JsonNode nodes = requiredArray(document, "nodes", 1, 80);
        Set<String> nodeIds = new java.util.HashSet<>();
        for (int index = 0; index < nodes.size(); index++) {
            JsonNode node = nodes.get(index);
            if (!node.isObject()) {
                throw invalid("session.document.nodes[" + index + "] 必须是对象。");
            }
            exactKeys(node, NODE_KEYS, NODE_REQUIRED_KEYS, "session.document.nodes[" + index + "]");
            String nodeId = requiredText(node, "id", 512);
            if (!nodeIds.add(nodeId)) {
                throw invalid("session.document.nodes 包含重复 id。");
            }
            if (!node.get("childIds").isArray()
                || !node.get("evidence").isArray()
                || (node.has("terms") && !node.get("terms").isArray())) {
                throw invalid("session.document node 的数组字段格式无效。");
            }
            JsonNode depth = node.get("depth");
            if (depth == null
                || !depth.canConvertToInt()
                || depth.intValue() < 0
                || depth.intValue() > 12) {
                throw invalid("session.document node depth 超出范围。");
            }
        }
        if (!nodeIds.contains(document.get("rootId").textValue())) {
            throw invalid("session.document.rootId 指向的节点不存在。");
        }

        JsonNode relations = requiredArray(document, "relations", 0, 640);
        for (int index = 0; index < relations.size(); index++) {
            JsonNode relation = relations.get(index);
            if (!relation.isObject()) {
                throw invalid("session.document.relations[" + index + "] 必须是对象。");
            }
            exactKeys(
                relation,
                RELATION_KEYS,
                RELATION_KEYS,
                "session.document.relations[" + index + "]"
            );
            requiredText(relation, "id", 512);
            requiredText(relation, "scopeId", 512);
            requiredText(relation, "from", 512);
            requiredText(relation, "to", 512);
        }
    }

    private static void validateMainCollections(JsonNode session) {
        JsonNode navigation = session.get("navigation");
        if (navigation == null || !navigation.isObject()) {
            throw invalid("session.navigation 必须是对象。");
        }
        exactKeys(
            navigation,
            Set.of("entries", "cursor"),
            Set.of("entries", "cursor"),
            "session.navigation"
        );
        requiredArray(navigation, "entries", 1, 60);
        JsonNode cursor = navigation.get("cursor");
        if (cursor == null
            || !cursor.canConvertToInt()
            || cursor.intValue() < 0
            || cursor.intValue() >= navigation.get("entries").size()) {
            throw invalid("session.navigation.cursor 超出范围。");
        }
        requiredArray(session, "termResults", 0, 48);
        JsonNode termCards = session.get("termCards");
        if (termCards == null || !termCards.isObject() || termCards.size() > 24) {
            throw invalid("session.termCards 必须是最多 24 项的对象。");
        }
        requiredArray(session, "visibleTermCardKeys", 0, 24);
        requiredArray(session, "deepResults", 0, 32);
        JsonNode activeDeepKey = session.get("activeDeepKey");
        if (activeDeepKey == null
            || (!activeDeepKey.isNull() && !activeDeepKey.isTextual())) {
            throw invalid("session.activeDeepKey 必须是字符串或 null。");
        }
        JsonNode profile = session.get("prefetchProfile");
        if (profile == null || !profile.isTextual() || !PROFILES.contains(profile.textValue())) {
            throw invalid("session.prefetchProfile 不受支持。");
        }
        requiredArray(session, "usageReceipts", 0, 256);
    }

    private static JsonNode requiredArray(
        JsonNode object,
        String field,
        int minimum,
        int maximum
    ) {
        JsonNode value = object.get(field);
        if (value == null
            || !value.isArray()
            || value.size() < minimum
            || value.size() > maximum) {
            throw invalid(field + " 数组长度无效。");
        }
        return value;
    }

    private static void exactKeys(
        JsonNode object,
        Set<String> allowed,
        Set<String> required,
        String path
    ) {
        Set<String> actual = new java.util.HashSet<>();
        object.fieldNames().forEachRemaining(actual::add);
        if (!allowed.containsAll(actual) || !actual.containsAll(required)) {
            throw invalid(path + " 字段集合无效。");
        }
    }

    private static void inspectFields(JsonNode node) {
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields =
                node.properties().iterator();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (DANGEROUS_FIELDS.contains(field.getKey())) {
                    throw invalid("session 包含危险字段。");
                }
                String normalized = field.getKey()
                    .replaceAll("[^A-Za-z0-9]", "")
                    .toLowerCase(Locale.ROOT);
                if (FORBIDDEN_FIELDS.contains(normalized)) {
                    throw invalid("session 包含禁止持久化的字段。");
                }
                inspectFields(field.getValue());
            }
        } else if (node.isArray()) {
            for (JsonNode item : node) {
                inspectFields(item);
            }
        }
    }

    private static String requiredText(JsonNode node, String field, int maxLength) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual()) {
            throw invalid(field + " 必须是字符串。");
        }
        String text = value.textValue();
        if (text.isBlank() || text.length() > maxLength) {
            throw invalid(field + " 长度无效。");
        }
        return text;
    }

    private static long requiredPositiveLong(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.canConvertToLong() || value.longValue() < 1) {
            throw invalid(field + " 必须是正整数。");
        }
        return value.longValue();
    }

    private static String requiredInstant(JsonNode node, String field) {
        String value = requiredText(node, field, 40);
        try {
            Instant.parse(value);
            return value;
        } catch (DateTimeParseException exception) {
            throw invalid(field + " 必须是 ISO-8601 UTC 时间。");
        }
    }

    private static ApiException invalid(String message) {
        return new ApiException("invalid_knowledge_session", message, 400, false);
    }

    public record ValidatedSession(
        String id,
        long revision,
        String title,
        String question,
        String createdAt,
        String updatedAt,
        String payloadJson
    ) {
    }
}
