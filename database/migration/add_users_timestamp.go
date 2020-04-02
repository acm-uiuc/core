package migration

const add_users_timestamp = `
ALTER TABLE users ADD created_at BIGINT NOT NULL;
`
