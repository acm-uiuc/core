package model

type Home struct {
	Entries []HomeItem `yaml:"entries"`
	Cards   []HomeItem `yaml:"cards"`
}

type HomeItem struct {
	Title string   `yaml:"title"`
	Body  string   `yaml:"body"`
	Link  HomeLink `yaml:"link"`
}

type HomeLink struct {
	Name string `yaml:"name"`
	Uri  string `yaml:"uri"`
}
