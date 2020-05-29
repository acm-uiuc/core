package model

type Home struct {
	Entries []HomeEntry `yaml:"entries"`
}

type HomeEntry struct {
	Title string   `yaml:"title"`
	Body  string   `yaml:"body"`
	Link  HomeLink `yaml:"link"`
}

type HomeLink struct {
	Name string `yaml:"name"`
	Uri  string `yaml:"uri"`
}
