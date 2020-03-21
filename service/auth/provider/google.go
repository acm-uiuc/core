package provider

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"

	"github.com/acm-uiuc/core/config"
)

type GoogleOAuth struct{}

func (oauth *GoogleOAuth) GetOAuthRedirect(target string) (string, error) {
	clientId, err := config.GetConfigValue("OAUTH_GOOGLE_ID")
	if err != nil {
		return "", fmt.Errorf("failed to get client id: %w", err)
	}

	redirectUri, err := config.GetConfigValue("OAUTH_REDIRECT_URI")
	if err != nil {
		return "", fmt.Errorf("failed to get oauth redirect: %w", err)
	}

	uri := url.URL{
		Scheme: "https",
		Host:   "accounts.google.com",
		Path:   "o/oauth2/v2/auth",
	}

	params := map[string]string{
		"client_id":     clientId,
		"scope":         "profile email",
		"response_type": "code",
		"redirect_uri":  redirectUri,
		"state":         target,
	}

	query := uri.Query()
	for key, value := range params {
		query.Set(key, value)
	}
	uri.RawQuery = query.Encode()

	return uri.String(), nil
}

func (oauth *GoogleOAuth) GetOAuthToken(code string) (string, error) {
	clientId, err := config.GetConfigValue("OAUTH_GOOGLE_ID")
	if err != nil {
		return "", fmt.Errorf("failed to get client id: %w", err)
	}

	clientSecret, err := config.GetConfigValue("OAUTH_GOOGLE_SECRET")
	if err != nil {
		return "", fmt.Errorf("failed to get client secret: %w", err)
	}

	redirectUri, err := config.GetConfigValue("OAUTH_REDIRECT_URI")
	if err != nil {
		return "", fmt.Errorf("failed to get oauth redirect: %w", err)
	}

	uri := url.URL{
		Scheme: "https",
		Host:   "www.googleapis.com",
		Path:   "oauth2/v4/token",
	}

	params := struct {
		ClientId     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		Code         string `json:"code"`
		RedirectUri  string `json:"redirect_uri"`
		GrantType    string `json:"grant_type"`
	}{
		ClientId:     clientId,
		ClientSecret: clientSecret,
		Code:         code,
		RedirectUri:  redirectUri,
		GrantType:    "authorization_code",
	}

	reqBody, err := json.Marshal(params)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request body: %w", err)
	}

	req, err := http.NewRequest("POST", uri.String(), bytes.NewBuffer(reqBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := http.Client{}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %w", err)
	}

	defer resp.Body.Close()

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	token := struct {
		Token string `json:"access_token"`
	}{}

	err = json.Unmarshal(respBody, &token)
	if err != nil {
		return "", fmt.Errorf("failed to decode response body: %w", err)
	}

	if token.Token == "" {
		return "", fmt.Errorf("invalid code")
	}

	return token.Token, nil
}

func (oauth *GoogleOAuth) GetVerifiedEmail(token string) (string, error) {
	uri := url.URL{
		Scheme: "https",
		Host:   "www.googleapis.com",
		Path:   "oauth2/v1/userinfo",
	}

	req, err := http.NewRequest("GET", uri.String(), nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	client := http.Client{}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %w", err)
	}

	defer resp.Body.Close()

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	email := struct {
		Email      string `json:"email"`
		IsVerified bool   `json:"verified_email"`
	}{}

	err = json.Unmarshal(respBody, &email)
	if err != nil {
		return "", fmt.Errorf("failed to decode response body: %w", err)
	}

	if !email.IsVerified || email.Email == "" {
		return "", fmt.Errorf("invalid authorization")
	}

	return email.Email, nil
}
