package model

type Event struct {
	Description    string         `yaml:"description"`
	Website        string         `yaml:"website"`
	WebsiteArchive []EventWebsite `yaml:"websiteArchive"`
}

type EventWebsite struct {
	Year int    `yaml:"year"`
	Uri  string `yaml:"uri"`
}
