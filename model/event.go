package model

type Event struct {
	Name           string         `yaml:"name"`
	Description    string         `yaml:"description"`
	LogoUri        string         `yaml:"logoUri"`
	Website        string         `yaml:"website"`
	WebsiteArchive []EventWebsite `yaml:"websiteArchive"`
}

type EventWebsite struct {
	Year int    `yaml:"year"`
	Uri  string `yaml:"uri"`
}
