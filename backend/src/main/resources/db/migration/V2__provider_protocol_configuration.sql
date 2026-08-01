ALTER TABLE provider_configs
    ADD COLUMN api_format VARCHAR(48);

ALTER TABLE provider_configs
    ADD COLUMN endpoint_mode VARCHAR(24) DEFAULT 'BASE_URL' NOT NULL;

ALTER TABLE provider_configs
    ADD COLUMN auth_type VARCHAR(32) DEFAULT 'BEARER' NOT NULL;

ALTER TABLE provider_configs
    ADD COLUMN auth_header VARCHAR(120);

UPDATE provider_configs
   SET api_format = 'OPENAI_CHAT_COMPLETIONS'
 WHERE provider_kind = 'MODEL'
   AND api_format IS NULL;

UPDATE provider_configs
   SET auth_type = 'CUSTOM_HEADER',
       auth_header = 'X-Subscription-Token'
 WHERE provider_type = 'BRAVE';
