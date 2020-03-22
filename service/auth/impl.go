package auth

import (
	"encoding/base64"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service/auth/provider"
)

const (
	validEmailDomain = "@illinois.edu"
	studentProvider  = "google"

	tokenLength   = 64
	tokenLifetime = 24
)

type authImpl struct {
	db *sqlx.DB
}

func (service *authImpl) GetOAuthRedirect(providerName string, target string) (string, error) {
	oauthProvider, err := provider.GetProvider(providerName)
	if err != nil {
		return "", fmt.Errorf("failed to get oauth provider %s: %w", providerName, err)
	}

	return oauthProvider.GetOAuthRedirect(target)
}

func (service *authImpl) Authorize(providerName string, code string) (*model.Token, error) {
	oauthProvider, err := provider.GetProvider(providerName)
	if err != nil {
		return nil, fmt.Errorf("failed to get oauth provider %s: %w", providerName, err)
	}

	oauthToken, err := oauthProvider.GetOAuthToken(code)
	if err != nil {
		return nil, fmt.Errorf("failed to get oauth token: %w", err)
	}

	email, err := oauthProvider.GetVerifiedEmail(oauthToken)
	if err != nil {
		return nil, fmt.Errorf("failed to get verified email: %w", err)
	}

	username := email
	if providerName == studentProvider {
		username, err = service.parseUsername(email)
		if err != nil {
			return nil, fmt.Errorf("failed to parse username: %w", err)
		}
	}

	token := &model.Token{
		Username:   username,
		Token:      service.generateTokenString(),
		Expiration: time.Now().Add(tokenLifetime * time.Hour).Unix(),
	}

	err = service.addToken(token)
	if err != nil {
		return nil, fmt.Errorf("failed to add token: %w", err)
	}

	return token, nil
}

func (service *authImpl) Verify(token string) (string, error) {
	username, err := service.tokenToUsername(token)
	if err != nil {
		return "", fmt.Errorf("verification failed: %w", err)
	}

	return username, nil
}

func (service *authImpl) parseUsername(email string) (string, error) {
	hasValidEmailDomain := len(email) > len(validEmailDomain) && strings.HasSuffix(email, validEmailDomain)
	if !hasValidEmailDomain {
		return "", fmt.Errorf("invalid email domain: %s", email)
	}

	username := email[0 : len(email)-len(validEmailDomain)]

	return username, nil
}

func (service *authImpl) generateTokenString() string {
	token := make([]byte, tokenLength)
	rand.Read(token)
	return base64.StdEncoding.EncodeToString(token)
}

func (service *authImpl) addToken(token *model.Token) error {
	_, err := service.db.NamedExec("INSERT INTO tokens (username, token, expiration) VALUES (:username, :token, :expiration)", token)
	if err != nil {
		return fmt.Errorf("failed to add token to database: %w", err)
	}

	return nil
}

func (service *authImpl) tokenToUsername(tokenString string) (string, error) {
	token := &model.Token{
		Token: tokenString,
	}

	rows, err := service.db.NamedQuery("SELECT username, token, expiration FROM tokens WHERE token=:token", token)
	if err != nil {
		return "", fmt.Errorf("failed to query database from token: %w", err)
	}

	result := &model.Token{}
	for rows.Next() {
		err := rows.StructScan(result)
		if err != nil {
			return "", fmt.Errorf("failed to decode row from database: %w", err)
		}
	}

	err = rows.Err()
	if err != nil {
		return "", fmt.Errorf("failed reading rows from database: %w", err)
	}

	if result.Username == "" {
		return "", fmt.Errorf("invalid token: %s", tokenString)
	}

	return result.Username, nil
}
