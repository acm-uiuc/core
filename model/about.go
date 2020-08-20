package model

type About struct {
	Content    []string     `yaml:"content"`
	Facilities []Facility   `yaml:"facilites"`
	History    AboutHistory `yaml:"history"`
	Links      []AboutLink  `yaml:"links"`
}

type Facility struct {
	Location    string `yaml:"location"`
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

type AboutLink struct {
	Name string `yaml:"name"`
	Uri  string `yaml:"uri"`
}

type AboutHistory struct {
	Events []AboutHistoryEvent `yaml:"events"`
}

type AboutHistoryEvent struct {
	Year  int    `yaml:"year"`
	Title string `yaml:"title"`
	Body  string `yaml:"body"`
}
