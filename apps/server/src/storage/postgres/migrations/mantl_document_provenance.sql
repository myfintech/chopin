CREATE TABLE document_changes (
	channel_id text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	id text NOT NULL,
	author_type text NOT NULL CHECK (author_type IN ('human', 'agent', 'system')),
	actor_key text NOT NULL,
	actor jsonb NOT NULL,
	via text NOT NULL CHECK (via IN ('browser', 'server', 'mcp', 'creation')),
	from_revision bigint NOT NULL CHECK (from_revision >= 0),
	to_revision bigint NOT NULL CHECK (to_revision >= from_revision),
	started_at timestamptz NOT NULL,
	ended_at timestamptz NOT NULL,
	blocks jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'),
	PRIMARY KEY (channel_id, id)
);

CREATE INDEX document_changes_history ON document_changes (channel_id, started_at, id);
CREATE INDEX document_changes_open ON document_changes (channel_id, actor_key, via, ended_at DESC);
