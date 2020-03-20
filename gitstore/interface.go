package gitstore

import (
	"fmt"

	"github.com/acm-uiuc/core/config"
)

type GitStore interface {
	ParseInto(path string, out interface{}) error
}

var gs GitStore

func New() (GitStore, error) {
	if gs == nil {
		basePath, err := config.GetConfigValue("GITSTORE_BASE_URI")
		if err != nil {
			return nil, fmt.Errorf("failed to get config value: %w", err)
		}

		store := &gitStoreImpl{
			basePath: basePath,
			data:     map[string]*gitStoreBlob{},
		}

		gs = store
	}

	return gs, nil
}
