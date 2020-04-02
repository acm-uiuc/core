package migration

import (
	"fmt"

	"github.com/acm-uiuc/core/database"
)

type migration struct {
	name    string
	command string
}

var migrations []migration = []migration{
	migration{name: "create_tokens_table", command: create_tokens_table},
	migration{name: "create_users_table", command: create_users_table},
	migration{name: "create_resumes_table", command: create_resumes_table},
	migration{name: "add_users_timestamp", command: add_users_timestamp},
	migration{name: "add_resumes_timestamp", command: add_resumes_timestamp},
}

func Migrate(startName string) error {
	db, err := database.New()
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	startIndex := -1
	if startName == "all" {
		startIndex = 0
	} else {
		for index, elem := range migrations {
			if elem.name == startName {
				startIndex = index
				break
			}
		}
	}

	if startIndex == -1 {
		return fmt.Errorf("invalid startName")
	}

	for i := startIndex; i < len(migrations); i++ {
		_, err := db.NamedExec(migrations[i].command, struct{}{})
		if err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
		fmt.Printf("Finish migration: %s\n", migrations[i].name)
	}

	return nil
}
