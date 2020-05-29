package model

type About struct {
	History   AboutHistory `yaml:"history"`
	Facilites []Facility   `yaml:"facilites"`
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
