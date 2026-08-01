ALTER TABLE chat_turns
    ADD COLUMN search_mode VARCHAR(16) DEFAULT 'AUTO' NOT NULL;

ALTER TABLE chat_turns
    ADD COLUMN search_status VARCHAR(24) DEFAULT 'LEGACY_UNKNOWN' NOT NULL;

ALTER TABLE chat_turns
    ADD COLUMN search_provider_config_id VARCHAR(36);

ALTER TABLE chat_turns
    ADD COLUMN search_call_count INTEGER DEFAULT 0 NOT NULL;
