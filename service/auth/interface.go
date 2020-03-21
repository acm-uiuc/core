package auth

import (
	"fmt"

	"github.com/acm-uiuc/core/database"
	"github.com/acm-uiuc/core/model"
)

type AuthService interface {
	GetOAuthRedirect(providerName string, target string) (string, error)
	Authorize(providerName string, code string) (*model.Token, error)
	Verify(token string) (string, error)
}

func New() (AuthService, error) {
	db, err := database.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create auth service: %w", err)
	}

	return &authImpl{
		db: db,
	}, nil
}
