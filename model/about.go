package model

type About struct {
	History AboutHistory `yaml:"history"`
}

type AboutHistory struct {
	Events []AboutHistoryEvent `yaml:"events"`
}

type AboutHistoryEvent struct {
	Year  int    `yaml:"year"`
	Title string `yaml:"title"`
	Body  string `yaml:"body"`
}
