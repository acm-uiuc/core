package provider

import (
	"fmt"

	"github.com/acm-uiuc/core/config"
)

type FakeOAuth struct{}

func (oauth *FakeOAuth) GetOAuthRedirect(target string) (string, error) {
	return "http://fake.oauth", nil
}

func (oauth *FakeOAuth) GetOAuthToken(code string) (string, error) {
	return "fake_token", nil
}

func (oauth *FakeOAuth) GetVerifiedEmail(token string) (string, error) {
	fakeUser, err := config.GetConfigValue("OAUTH_FAKE_USER")
	if err != nil {
		return "", fmt.Errorf("failed to get fake user: %w", err)
	}

	return fakeUser, nil
}
