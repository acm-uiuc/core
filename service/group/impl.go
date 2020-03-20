package group

import (
	"fmt"

	"github.com/acm-uiuc/core/config"
	"github.com/acm-uiuc/core/gitstore"
	"github.com/acm-uiuc/core/model"
)

type groupImpl struct {
	gs gitstore.GitStore
}

func (service *groupImpl) GetGroups() (map[string][]model.Group, error) {
	path, err := config.GetConfigValue("GROUP_URI")
	if err != nil {
		return nil, fmt.Errorf("failed to get config value: %w", err)
	}

	data := map[string][]model.Group{}
	err = service.gs.ParseInto(path, &data)
	if err != nil {
		fmt.Errorf("failed to parse group data: %w", err)
	}

	return data, nil
}

func (service *groupImpl) VerifyMembership(username string, groupType string, groupName string) (bool, error) {
	allGroups, err := service.GetGroups()
	if err != nil {
		return false, fmt.Errorf("failed to get groups: %w", err)
	}

	groups, ok := allGroups[groupType]
	if !ok {
		return false, fmt.Errorf("failed to find data for group type: %s", groupType)
	}

	for _, group := range groups {
		if group.Name == groupName {
			for _, member := range group.Members {
				if member.Username == username {
					return true, nil
				}
			}

			return false, nil
		}
	}

	return false, fmt.Errorf("failed to find data for group name: %s", groupName)
}
