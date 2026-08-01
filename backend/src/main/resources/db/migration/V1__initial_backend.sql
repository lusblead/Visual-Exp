CREATE TABLE knowledge_sessions (
    owner_id VARCHAR(80) NOT NULL,
    session_id VARCHAR(120) NOT NULL,
    protocol VARCHAR(80) NOT NULL,
    title VARCHAR(240) NOT NULL,
    question TEXT NOT NULL,
    client_revision BIGINT NOT NULL,
    payload_json TEXT,
    placeholder BOOLEAN NOT NULL,
    active BOOLEAN NOT NULL,
    active_slot VARCHAR(8),
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (owner_id, session_id)
);

CREATE INDEX idx_knowledge_sessions_owner_updated
    ON knowledge_sessions (owner_id, updated_at);

CREATE UNIQUE INDEX uq_knowledge_sessions_active
    ON knowledge_sessions (owner_id, active_slot);

CREATE TABLE provider_configs (
    owner_id VARCHAR(80) NOT NULL,
    config_id VARCHAR(36) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    provider_kind VARCHAR(16) NOT NULL,
    provider_type VARCHAR(48) NOT NULL,
    base_url VARCHAR(1000),
    default_model VARCHAR(160),
    encrypted_api_key TEXT NOT NULL,
    active BOOLEAN NOT NULL,
    active_slot VARCHAR(8),
    last_verified_at VARCHAR(40) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (owner_id, config_id)
);

CREATE INDEX idx_provider_configs_owner_kind
    ON provider_configs (owner_id, provider_kind, updated_at);

CREATE UNIQUE INDEX uq_provider_configs_active
    ON provider_configs (owner_id, provider_kind, active_slot);

CREATE TABLE chat_turns (
    owner_id VARCHAR(80) NOT NULL,
    turn_id VARCHAR(36) NOT NULL,
    session_id VARCHAR(120) NOT NULL,
    client_turn_id VARCHAR(120) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    user_text TEXT NOT NULL,
    assistant_text TEXT,
    selected_text TEXT NOT NULL,
    source_node_id VARCHAR(160) NOT NULL,
    provider_config_id VARCHAR(36),
    sources_json TEXT NOT NULL,
    error_code VARCHAR(80),
    created_at VARCHAR(40) NOT NULL,
    completed_at VARCHAR(40),
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (owner_id, turn_id),
    CONSTRAINT uq_chat_turn_client UNIQUE (owner_id, client_turn_id)
);

CREATE INDEX idx_chat_turns_owner_session_created
    ON chat_turns (owner_id, session_id, created_at);
