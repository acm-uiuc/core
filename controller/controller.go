package controller

import (
	"fmt"

	"github.com/labstack/echo"
	echoMiddleware "github.com/labstack/echo/middleware"

	"github.com/acm-uiuc/core/config"
	"github.com/acm-uiuc/core/context"
	"github.com/acm-uiuc/core/middleware"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service"
	"github.com/acm-uiuc/core/template"

	"github.com/acm-uiuc/core/controller/auth"
	"github.com/acm-uiuc/core/controller/docs"
	"github.com/acm-uiuc/core/controller/group"
	"github.com/acm-uiuc/core/controller/resume"
	"github.com/acm-uiuc/core/controller/site"
	"github.com/acm-uiuc/core/controller/user"
)

type Controller struct {
	*echo.Echo
	svc  *service.Service
	tmpl *template.Template
}

func New(svc *service.Service) (*Controller, error) {
	tmpl, err := template.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create templates: %w", err)
	}

	controller := &Controller{
		Echo: echo.New(),
		svc:  svc,
		tmpl: tmpl,
	}

	controller.Echo.Renderer = controller.tmpl

	docsController := docs.New(controller.svc)
	authController := auth.New(controller.svc)
	userController := user.New(controller.svc)
	groupController := group.New(controller.svc)
	resumeController := resume.New(controller.svc)
	siteController := site.New(controller.svc)

	staticBase, err := config.GetConfigValue("STATIC_BASE")
	if err != nil {
		return nil, fmt.Errorf("failed to get static base")
	}

	controller.Use(echoMiddleware.Logger())
	controller.Use(echoMiddleware.Recover())
	controller.Use(middleware.Context(controller.svc))

	controller.Static("/static", staticBase)

	controller.GET(
		"/api",
		Chain(docsController.Documentation),
	)

	controller.GET(
		"/api/auth/:provider",
		Chain(authController.GetOAuthRedirect),
	)
	controller.GET(
		"/api/auth/:provider/redirect",
		Chain(authController.GetOAuthRedirectLanding),
	)
	controller.POST(
		"/api/auth/:provider",
		Chain(authController.GetToken),
	)

	controller.GET(
		"/api/user",
		Chain(userController.GetUser, middleware.AuthorizeMatchAnyAPI(
			controller.svc, middleware.AuthorizeMatchParameters{
				Marks: model.UserValidMarks,
			},
		)),
	)
	controller.POST(
		"/api/user",
		Chain(userController.CreateUser),
	)
	controller.GET(
		"/api/user/filter",
		Chain(userController.GetUsers, middleware.AuthorizeMatchAnyAPI(
			controller.svc, middleware.AuthorizeMatchParameters{
				Marks:      []string{model.UserMarkRecruiter},
				Committees: []string{model.GroupTop4, model.GroupAdmin},
			},
		)),
	)
	controller.POST(
		"/api/user/mark",
		Chain(userController.MarkUser, middleware.AuthorizeMatchAnyAPI(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupAdmin},
			},
		)),
	)
	controller.DELETE(
		"/api/user",
		Chain(userController.DeleteUser, middleware.AuthorizeMatchAnyAPI(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"/api/group",
		Chain(groupController.GetGroups),
	)
	controller.POST(
		"/api/group/verify",
		Chain(groupController.VerifyMembership),
	)

	controller.POST(
		"/api/resume",
		Chain(resumeController.UploadResume),
	)
	controller.GET(
		"/api/resume/filter",
		Chain(resumeController.GetResumes, middleware.AuthorizeMatchAnyAPI(
			controller.svc, middleware.AuthorizeMatchParameters{
				Marks:      []string{model.UserMarkRecruiter},
				Committees: []string{model.GroupTop4, model.GroupCorporate, model.GroupAdmin},
			},
		)),
	)
	controller.POST(
		"/api/resume/approve",
		Chain(resumeController.ApproveResume, middleware.AuthorizeMatchAnyAPI(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupCorporate, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"/",
		Chain(siteController.Home),
	)

	controller.GET(
		"/about",
		Chain(siteController.About),
	)

	controller.GET(
		"/about/history",
		Chain(siteController.History),
	)

	controller.GET(
		"/reflectionsprojections",
		Chain(siteController.ReflectionsProjections),
	)

	controller.GET(
		"/hackillinois",
		Chain(siteController.HackIllinois),
	)

	controller.GET(
		"/hackthis",
		Chain(siteController.HackThis),
	)

	controller.GET(
		"/sponsors",
		Chain(siteController.Sponsors),
	)

	controller.GET(
		"/sigs",
		Chain(siteController.Sigs),
	)

	controller.GET(
		"/login",
		Chain(siteController.Login),
	)

	controller.GET(
		"/logout",
		Chain(siteController.Logout),
	)

	controller.GET(
		"/join",
		Chain(siteController.Join),
	)

	controller.GET(
		"/resumeupload",
		Chain(siteController.ResumeUpload),
	)

	controller.GET(
		"/resumebook",
		Chain(siteController.ResumeBook, middleware.AuthorizeMatchAnyWebPage(
			controller.svc, middleware.AuthorizeMatchParameters{
				Marks:      []string{model.UserMarkRecruiter},
				Committees: []string{model.GroupTop4, model.GroupCorporate, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"/intranet",
		Chain(siteController.Intranet),
	)

	controller.GET(
		"/intranet/usermanager",
		Chain(siteController.UserManager, middleware.AuthorizeMatchAnyWebPage(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"/intranet/recruitercreator",
		Chain(siteController.RecruiterCreator, middleware.AuthorizeMatchAnyWebPage(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupCorporate, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"/intranet/recruitermanager",
		Chain(siteController.RecruiterManager, middleware.AuthorizeMatchAnyWebPage(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupCorporate, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"/intranet/resumemanager",
		Chain(siteController.ResumeManager, middleware.AuthorizeMatchAnyWebPage(
			controller.svc, middleware.AuthorizeMatchParameters{
				Committees: []string{model.GroupTop4, model.GroupCorporate, model.GroupAdmin},
			},
		)),
	)

	controller.GET(
		"*",
		Chain(siteController.NotFound),
	)

	return controller, nil
}

func ContextConverter(handler func(*context.Context) error) func(echo.Context) error {
	return func(c echo.Context) error {
		ctx, ok := c.(*context.Context)
		if !ok {
			return fmt.Errorf("failed to convert context")
		}
		return handler(ctx)
	}
}

func Chain(handler func(*context.Context) error, middlewares ...(func(next echo.HandlerFunc) echo.HandlerFunc)) func(echo.Context) error {
	aggregated := ContextConverter(handler)
	for i := range middlewares {
		aggregated = middlewares[len(middlewares)-i-1](aggregated)
	}

	return aggregated
}
