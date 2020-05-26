package model

type Group struct {
	Name            string        `yaml:"name"`
	Description     string        `yaml:"description"`
	Chairs          string        `yaml:"chairs"`
	Members         []GroupMember `yaml:"members"`
	MeetingTime     string        `yaml:"meetingTime"`
	MeetingLocation string        `yaml:"meetingLocation"`
	Website         string        `yaml:"website"`
	Email           string        `yaml:"email"`
}

type GroupMember struct {
	Username    string `yaml:"username"`
	Role        string `yaml:"role"`
	DisplayName string `yaml:"displayName"`
	Email       string `yaml:"email"`
}

const (
	GroupCommittees = "committees"
	GroupSIGs       = "sigs"

	GroupTop4      = "Top4"
	GroupCorporate = "Corporate"
)
