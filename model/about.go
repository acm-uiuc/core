package model

type About struct {
	Content   []string     `yaml:"content"`
	Facilites []Facility   `yaml:"facilites"`
	History   AboutHistory `yaml:"history"`
}

type Facility struct {
	Location    string `yaml:"location"`
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

type AboutHistory struct {
	Events []AboutHistoryEvent `yaml:"events"`
}

type AboutHistoryEvent struct {
	Year  int    `yaml:"year"`
	Title string `yaml:"title"`
	Body  string `yaml:"body"`
}
