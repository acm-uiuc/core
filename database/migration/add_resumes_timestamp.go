package migration

const add_resumes_timestamp = `
ALTER TABLE resumes ADD updated_at BIGINT NOT NULL;
`
