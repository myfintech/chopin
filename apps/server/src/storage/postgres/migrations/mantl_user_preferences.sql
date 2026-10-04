CREATE TABLE user_preferences (
	user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	theme text NOT NULL CHECK (theme IN ('light', 'dark', 'system')),
	updated_at timestamptz NOT NULL
);
