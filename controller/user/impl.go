package user

import (
	"net/http"
	"time"

	"github.com/acm-uiuc/core/context"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service"
)

type UserController struct {
	svc *service.Service
}

func New(svc *service.Service) *UserController {
	return &UserController{
		svc: svc,
	}
}

func (controller *UserController) GetUser(ctx *context.Context) error {
	user, err := controller.svc.User.GetUser(ctx.Username)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed User Lookup",
			"could not retrieve user details",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, user)
}

func (controller *UserController) CreateUser(ctx *context.Context) error {
	req := model.User{}

	err := ctx.Bind(&req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Bind",
			"malformed request",
			err,
		)
	}

	req.Mark = model.UserMarkBasic
	req.CreatedAt = time.Now().Unix()

	err = controller.svc.User.CreateUser(req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed User Creation",
			"could not add user to database",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, struct{}{})
}

func (controller *UserController) GetUsers(ctx *context.Context) error {
	users, err := controller.svc.User.GetUsers()
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Users Lookup",
			"could not retrieve users details",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, users)
}

func (controller *UserController) MarkUser(ctx *context.Context) error {
	req := struct {
		Username string `json:"username"`
		Mark     string `json:"mark"`
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

	err = controller.svc.User.MarkUser(req.Username, req.Mark)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed User Marking",
			"could not update user mark",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, struct{}{})
}

func (controller *UserController) DeleteUser(ctx *context.Context) error {
	req := model.User{}

	err := ctx.Bind(&req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Bind",
			"malformed request",
			err,
		)
	}

	err = controller.svc.User.DeleteUser(req.Username)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed User Deletion",
			"could not delete user from database",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, struct{}{})
}
