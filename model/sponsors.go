package model

type Sponsors struct {
	Packages []SponsorshipPackage `yaml:"packages"`
}

type SponsorshipPackage struct {
	Name  string   `yaml:"name"`
	Price string   `yaml:"price"`
	Items []string `yaml:"items"`
}
