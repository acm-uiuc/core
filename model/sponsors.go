package model

type Sponsors struct {
	Pitch       string               `yaml:"pitch"`
	GetInvolved string               `yaml:"getInvolved"`
	Packages    []SponsorshipPackage `yaml:"packages"`
}

type SponsorshipPackage struct {
	Name  string   `yaml:"name"`
	Price string   `yaml:"price"`
	Items []string `yaml:"items"`
}
