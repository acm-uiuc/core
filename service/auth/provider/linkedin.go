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

type LinkedinOAuth struct{}

func (oauth *LinkedinOAuth) GetOAuthRedirect(target string) (string, error) {
	clientId, err := config.GetConfigValue("OAUTH_LINKEDIN_ID")
	if err != nil {
		return "", fmt.Errorf("failed to get client id: %w", err)
	}

	redirectUri, err := config.GetConfigValue("OAUTH_LINKEDIN_REDIRECT_URI")
	if err != nil {
		return "", fmt.Errorf("failed to get oauth redirect: %w", err)
	}

	uri := url.URL{
		Scheme: "https",
		Host:   "www.linkedin.com",
		Path:   "oauth/v2/authorization",
	}

	params := map[string]string{
		"client_id":     clientId,
		"scope":         "r_liteprofile r_emailaddress",
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

func (oauth *LinkedinOAuth) GetOAuthToken(code string) (string, error) {
	clientId, err := config.GetConfigValue("OAUTH_LINKEDIN_ID")
	if err != nil {
		return "", fmt.Errorf("failed to get client id: %w", err)
	}

	clientSecret, err := config.GetConfigValue("OAUTH_LINKEDIN_SECRET")
	if err != nil {
		return "", fmt.Errorf("failed to get client secret: %w", err)
	}

	redirectUri, err := config.GetConfigValue("OAUTH_LINKEDIN_REDIRECT_URI")
	if err != nil {
		return "", fmt.Errorf("failed to get oauth redirect: %w", err)
	}

	uri := url.URL{
		Scheme: "https",
		Host:   "www.linkedin.com",
		Path:   "oauth/v2/accessToken",
	}

	params := url.Values{}
	params.Set("client_id", clientId)
	params.Set("client_secret", clientSecret)
	params.Set("code", code)
	params.Set("redirect_uri", redirectUri)
	params.Set("grant_type", "authorization_code")

	reqBody := []byte(params.Encode())

	req, err := http.NewRequest("POST", uri.String(), bytes.NewBuffer(reqBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-li-format", "json")

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

func (oauth *LinkedinOAuth) GetVerifiedEmail(token string) (string, error) {
	uri := url.URL{
		Scheme: "https",
		Host:   "api.linkedin.com",
		Path:   "v2/emailAddress",
	}

	params := map[string]string{
		"q":          "members",
		"projection": "(elements*(handle~))",
	}

	query := uri.Query()
	for key, value := range params {
		query.Set(key, value)
	}
	uri.RawQuery = query.Encode()

	req, err := http.NewRequest("GET", uri.String(), nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-li-format", "json")
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
		Elements []struct {
			Handle struct {
				Email string `json:"emailAddress"`
			} `json:"handle~"`
		} `json:"elements"`
	}{}

	err = json.Unmarshal(respBody, &email)
	if err != nil {
		return "", fmt.Errorf("failed to decode response body: %w", err)
	}

	if len(email.Elements) == 0 || email.Elements[0].Handle.Email == "" {
		return "", fmt.Errorf("invalid authorization")
	}

	return email.Elements[0].Handle.Email, nil
}
