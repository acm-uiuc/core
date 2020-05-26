package model

type Intranet struct {
	Cards []IntranetCard `yaml:"cards"`
	Links []IntranetLink `yaml:"links"`
}

type IntranetCard struct {
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Uri         string   `yaml:"uri"`
	Groups      []string `yaml:"groups"`
	Marks       []string `yaml:"marks"`
}

type IntranetLink struct {
	Name string `yaml:"name"`
	Uri  string `yaml:"uri"`
}
