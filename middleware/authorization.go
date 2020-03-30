package middleware

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo"

	"github.com/acm-uiuc/core/context"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service"
)

type AuthorizeMatchParameters struct {
	Marks      []string
	Committees []string
}

func AuthorizeMatchAnyAPI(svc *service.Service, match AuthorizeMatchParameters) func(echo.HandlerFunc) echo.HandlerFunc {
	return AuthorizeMatchAny(context.ContextErrorFormatJSON, svc, match)
}

func AuthorizeMatchAnyWebPage(svc *service.Service, match AuthorizeMatchParameters) func(echo.HandlerFunc) echo.HandlerFunc {
	return AuthorizeMatchAny(context.ContextErrorFormatHTML, svc, match)
}

func AuthorizeMatchAny(format context.ContextError, svc *service.Service, match AuthorizeMatchParameters) func(echo.HandlerFunc) echo.HandlerFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx, ok := c.(*context.Context)
			if !ok {
				return ctx.ErrorWithFormat(
					format,
					http.StatusForbidden,
					"Invalid Context",
					"could not convert context",
					fmt.Errorf("could not convert context"),
				)
			}

			isMarkMatch, err := hasMarkMatch(svc, ctx.Username, match.Marks)
			if err != nil {
				message := "could not find user marks; " +
					"students: ensure you have filled out the join form to create an account; " +
					"recruiters: please reach out to the corporate team for help creating an account"
				return ctx.ErrorWithFormat(
					format,
					http.StatusForbidden,
					"Failed Mark Match",
					message,
					err,
				)
			}

			isCommitteeMatch, err := hasCommitteeMatch(svc, ctx.Username, match.Committees)
			if err != nil {
				return ctx.ErrorWithFormat(
					format,
					http.StatusForbidden,
					"Failed Committee Match",
					"could not find commitee information",
					err,
				)
			}

			if !isMarkMatch && !isCommitteeMatch {
				message := "unauthorized attempt to access resource; " +
					"students: please be patient as access to paid resources need to be manually granted by an administrator; " +
					"recruiters: please reach out to the corporate team for help whitelisting account"
				return ctx.ErrorWithFormat(
					format,
					http.StatusForbidden,
					"Invalid Authorization Matches",
					message,
					fmt.Errorf("unauthorized attempt to access resource"),
				)
			}

			return next(ctx)
		}
	}
}

func hasMarkMatch(svc *service.Service, username string, marks []string) (bool, error) {
	user, err := svc.User.GetUser(username)
	if err != nil {
		return false, fmt.Errorf("failed to find user: %w", err)
	}

	for _, mark := range marks {
		if user.Mark == mark {
			return true, nil
		}
	}

	return false, nil
}

func hasCommitteeMatch(svc *service.Service, username string, committees []string) (bool, error) {
	for _, committee := range committees {
		isMember, err := svc.Group.VerifyMembership(username, model.GroupCommittees, committee)
		if err != nil {
			return false, fmt.Errorf("failed verifying membership: %w", err)
		}

		if isMember {
			return true, nil
		}
	}

	return false, nil
}
