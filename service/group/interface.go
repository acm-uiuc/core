package group

import (
	"fmt"

	"github.com/acm-uiuc/core/gitstore"
	"github.com/acm-uiuc/core/model"
)

type GroupService interface {
	GetGroups() (map[string][]model.Group, error)
	VerifyMembership(username string, groupType string, groupName string) (bool, error)
}

func New() (GroupService, error) {
	gs, err := gitstore.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create group service: %w", err)
	}

	return &groupImpl{
		gs: gs,
	}, nil
}
