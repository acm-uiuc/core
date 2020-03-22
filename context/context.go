package context

import (
	"fmt"

	"github.com/labstack/echo"
)

type Context struct {
	echo.Context
	Username string
	LoggedIn bool
}

func (ctx *Context) RenderError(code int, title string, message string, err error) error {
	params := struct {
		Authenticated bool
		Title         string
		Message       string
	}{
		Authenticated: ctx.LoggedIn,
		Title:         title,
		Message:       message,
	}

	rerr := ctx.Render(code, "error", params)
	if rerr != nil {
		return fmt.Errorf("failed to render error: %w, original error: %w", rerr, err)
	}

	return err
}
