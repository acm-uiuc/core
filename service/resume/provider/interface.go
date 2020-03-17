package provider

import (
	"fmt"

	"github.com/acm-uiuc/core/config"
)

type StorageProvider interface {
	GetSignedUri(blobKey string, method string) (string, error)
}

var providers map[string]StorageProvider = map[string]StorageProvider{
	"google": &GoogleStorage{},
}

func GetProvider(provider string) (StorageProvider, error) {
	isTest, err := config.GetConfigValue("IS_TEST")
	if err != nil {
		return nil, fmt.Errorf("failed to check if in test: %w", err)
	}

	isDev, err := config.GetConfigValue("IS_DEV")
	if err != nil {
		return nil, fmt.Errorf("failed to check if in dev: %w", err)
	}

	if isTest == "true" || isDev == "true" {
		return &FakeStorage{}, nil
	}

	storage, ok := providers[provider]
	if !ok {
		return nil, fmt.Errorf("invalid provider: %s", provider)
	}

	return storage, nil
}
