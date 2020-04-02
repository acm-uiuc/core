package model

type User struct {
	Username  string `db:"username" json:"username"`
	FirstName string `db:"first_name" json:"first_name"`
	LastName  string `db:"last_name" json:"last_name"`
	Mark      string `db:"mark" json:"mark"`
	CreatedAt int64  `db:"created_at" json:"created_at"`
}

const (
	UserMarkBasic     = "BASIC"
	UserMarkPaid      = "PAID"
	UserMarkRecruiter = "RECRUITER"
)

var (
	UserValidMarks = []string{UserMarkBasic, UserMarkPaid, UserMarkRecruiter}
)
