package auth

import (
	"fmt"
	"net/http"
	"time"

	"github.com/acm-uiuc/core/context"
	"github.com/acm-uiuc/core/service"
)

type AuthController struct {
	svc *service.Service
}

func New(svc *service.Service) *AuthController {
	return &AuthController{
		svc: svc,
	}
}

func (controller *AuthController) GetOAuthRedirect(ctx *context.Context) error {
	provider := ctx.Param("provider")
	target := ctx.QueryParam("target")
	if target == "" {
		target = "/"
	}

	uri, err := controller.svc.Auth.GetOAuthRedirect(provider, target)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Invalid Provider",
			fmt.Sprintf("%s is not a valid provider", provider),
			err,
		)
	}

	return ctx.Redirect(http.StatusFound, uri)
}

func (controller *AuthController) GetOAuthRedirectLanding(ctx *context.Context) error {
	params := struct {
		Provider      string
		Authenticated bool
	}{
		Provider:      ctx.Param("provider"),
		Authenticated: false,
	}

	return ctx.Render(http.StatusOK, "redirect", params)
}

func (controller *AuthController) GetToken(ctx *context.Context) error {
	provider := ctx.Param("provider")

	req := struct {
		Code string `json:"code"`
	}{}

	err := ctx.Bind(&req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Bind",
			"malformed request",
			err,
		)
	}

	token, err := controller.svc.Auth.Authorize(provider, req.Code)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Token Generation",
			"could not generate an authorization token",
			err,
		)
	}

	ctx.SetCookie(&http.Cookie{
		Name:     "token",
		Value:    token.Token,
		Expires:  time.Unix(token.Expiration, 0),
		Path:     "/",
		HttpOnly: true,
	})

	return ctx.JSON(http.StatusOK, token)
}
