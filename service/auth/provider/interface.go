package provider

import (
	"fmt"

	"github.com/acm-uiuc/core/config"
)

type OAuthProvider interface {
	GetOAuthRedirect(target string) (string, error)
	GetOAuthToken(code string) (string, error)
	GetVerifiedEmail(token string) (string, error)
}

var providers map[string]OAuthProvider = map[string]OAuthProvider{
	"google":   &GoogleOAuth{},
	"linkedin": &LinkedinOAuth{},
}

func GetProvider(provider string) (OAuthProvider, error) {
	isTest, err := config.GetConfigValue("IS_TEST")
	if err != nil {
		return nil, fmt.Errorf("failed to check if in test: %w", err)
	}

	isDev, err := config.GetConfigValue("IS_DEV")
	if err != nil {
		return nil, fmt.Errorf("failed to check if in dev: %w", err)
	}

	if isTest == "true" || isDev == "true" {
		return &FakeOAuth{}, nil
	}

	oauth, ok := providers[provider]
	if !ok {
		return nil, fmt.Errorf("invalid provider: %s", provider)
	}

	return oauth, nil
}
