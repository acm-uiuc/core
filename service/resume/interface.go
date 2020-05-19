package resume

import (
	"fmt"

	"github.com/acm-uiuc/core/database"
	"github.com/acm-uiuc/core/model"
)

type ResumeService interface {
	UploadResume(resume model.Resume) (string, error)
	GetResumes() ([]model.Resume, error)
	GetFilteredResumes(filters map[string][]string) ([]model.Resume, error)
	ApproveResume(username string) error
}

func New() (ResumeService, error) {
	db, err := database.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create resume service: %w", err)
	}

	return &resumeImpl{
		db: db,
	}, nil
}
