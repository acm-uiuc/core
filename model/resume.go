package model

type Resume struct {
	Username        string `db:"username" json:"username"`
	FirstName       string `db:"first_name" json:"first_name"`
	LastName        string `db:"last_name" json:"last_name"`
	Email           string `db:"email" json:"email"`
	GraduationMonth int    `db:"graduation_month" json:"graduation_month"`
	GraduationYear  int    `db:"graduation_year" json:"graduation_year"`
	Major           string `db:"major" json:"major"`
	Degree          string `db:"degree" json:"degree"`
	Seeking         string `db:"seeking" json:"seeking"`
	BlobKey         string `db:"blob_key" json:"blob_key"`
	Approved        bool   `db:"approved" json:"approved"`
	UpdatedAt       int64  `db:"updated_at" json:"updated_at"`
}

type ResumeOptions struct {
	GraduationMonths []int
	GraduationYears  []int
	Degrees          []string
	Seekings         []string
	Majors           []string
}

var ResumeValidOptions = ResumeOptions{
	GraduationMonths: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
	GraduationYears:  []int{2020, 2021, 2022, 2023, 2024, 2025},
	Degrees:          []string{"Bachelors", "Masters", "PhD"},
	Seekings:         []string{"Internship", "Co Op", "Full Time"},
	Majors:           []string{"Computer Science", "Computer Engineering", "Electrical Enginering", "Mathematics", "Other Engineering", "Other Sciences", "Other"},
}
