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

type ContextError string

const (
	ContextErrorFormatJSON ContextError = "json"
	ContextErrorFormatHTML ContextError = "html"
)

func (ctx *Context) ErrorWithFormat(format ContextError, code int, title string, message string, err error) error {
	switch format {
	case ContextErrorFormatJSON:
		return ctx.JSONError(code, title, message, err)
	case ContextErrorFormatHTML:
		return ctx.RenderError(code, title, message, err)
	default:
		err := ctx.String(code, fmt.Sprintf("%s\n%s\n", title, message))
		if err != nil {
			return fmt.Errorf("invalid error format: %s, failed to write string reponse: %w", format, err)
		}

		return fmt.Errorf("invalid error format: %s", format)
	}
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

func (ctx *Context) JSONError(code int, title string, message string, err error) error {
	jerr := ctx.JSON(code, &struct {
		Title   string `json:"title"`
		Message string `json:"message"`
	}{
		Title:   title,
		Message: message,
	})
	if jerr != nil {
		return fmt.Errorf("failed to marshal error: %w, original error: %w", jerr, err)
	}

	return err
}
