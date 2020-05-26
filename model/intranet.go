package model

type Intranet struct {
	Cards []IntranetCard `yaml:"cards"`
}

type IntranetCard struct {
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Uri         string   `yaml:"uri"`
	Groups      []string `yaml:"groups"`
}
