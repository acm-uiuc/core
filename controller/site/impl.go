package site

import (
	"fmt"
	"net/http"
	"time"

	"github.com/acm-uiuc/core/config"
	"github.com/acm-uiuc/core/context"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service"
)

type SiteController struct {
	svc *service.Service
}

func New(svc *service.Service) *SiteController {
	return &SiteController{
		svc: svc,
	}
}

func (controller *SiteController) Home(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	return ctx.Render(http.StatusOK, "home", params)
}

func (controller *SiteController) About(ctx *context.Context) error {
	groups, err := controller.svc.Group.GetGroups()
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Groups",
			"could not get group data",
			err,
		)
	}

	committees, ok := groups[model.GroupCommittees]
	if !ok {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Committees",
			"could not get committees in group data",
			fmt.Errorf("failed getting committees"),
		)
	}

	params := struct {
		Authenticated bool
		Committees    []model.Group
	}{
		Authenticated: ctx.LoggedIn,
		Committees:    committees,
	}

	return ctx.Render(http.StatusOK, "about", params)
}

func (controller *SiteController) History(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	return ctx.Render(http.StatusOK, "history", params)
}

func (controller *SiteController) ReflectionsProjections(ctx *context.Context) error {
	eventUri, err := config.GetConfigValue("REFLECTIONSPROJECTIONS_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Event Data",
			"could not get event data uri",
			err,
		)
	}

	event := model.Event{}
	err = controller.svc.Store.ParseInto(eventUri, &event)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Event Data",
			"could not parse event data",
			err,
		)
	}

	params := struct {
		Authenticated bool
		Event         model.Event
	}{
		Authenticated: ctx.LoggedIn,
		Event:         event,
	}

	return ctx.Render(http.StatusOK, "reflectionsprojections", params)
}

func (controller *SiteController) HackIllinois(ctx *context.Context) error {
	eventUri, err := config.GetConfigValue("HACKILLINOIS_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Event Data",
			"could not get event data uri",
			err,
		)
	}

	event := model.Event{}
	err = controller.svc.Store.ParseInto(eventUri, &event)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Event Data",
			"could not parse event data",
			err,
		)
	}

	params := struct {
		Authenticated bool
		Event         model.Event
	}{
		Authenticated: ctx.LoggedIn,
		Event:         event,
	}

	return ctx.Render(http.StatusOK, "hackillinois", params)
}

func (controller *SiteController) Sponsors(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	return ctx.Render(http.StatusOK, "sponsors", params)
}

func (controller *SiteController) Sigs(ctx *context.Context) error {
	groups, err := controller.svc.Group.GetGroups()
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Groups",
			"could not get group data",
			err,
		)
	}

	sigs, ok := groups[model.GroupSIGs]
	if !ok {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Sigs",
			"could not get sigs in group data",
			fmt.Errorf("failed getting sigs"),
		)
	}

	sigsColLeft := sigs[:len(sigs)/2]
	sigsColRight := sigs[len(sigs)/2:]

	params := struct {
		Authenticated bool
		SigsColLeft   []model.Group
		SigsColRight  []model.Group
	}{
		Authenticated: ctx.LoggedIn,
		SigsColLeft:   sigsColLeft,
		SigsColRight:  sigsColRight,
	}

	return ctx.Render(http.StatusOK, "sigs", params)
}

func (controller *SiteController) Login(ctx *context.Context) error {
	isDev, err := config.GetConfigValue("IS_DEV")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Checking Mode",
			"could not determine if in dev mode",
			err,
		)
	}

	params := struct {
		Authenticated bool
		IsDev         bool
	}{
		Authenticated: ctx.LoggedIn,
		IsDev:         isDev == "true",
	}

	return ctx.Render(http.StatusOK, "login", params)
}

func (controller *SiteController) Logout(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	ctx.SetCookie(&http.Cookie{
		Name:     "token",
		Value:    "",
		MaxAge:   -1,
		Path:     "/",
		HttpOnly: true,
	})

	return ctx.Render(http.StatusOK, "logout", params)
}

func (controller *SiteController) Join(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	return ctx.Render(http.StatusOK, "join", params)
}

func (controller *SiteController) ResumeUpload(ctx *context.Context) error {
	params := struct {
		Authenticated    bool
		model.ResumeOptions
	}{
		Authenticated: ctx.LoggedIn,
		ResumeOptions: model.ResumeValidOptions,
	}

	return ctx.Render(http.StatusOK, "resumeupload", params)
}

func (controller *SiteController) UserManager(ctx *context.Context) error {
	users, err := controller.svc.User.GetUsers()
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Users",
			"could not get users data",
			err,
		)
	}

	extendedUsers := []struct {
		model.User
		HumanTimestamp string
	}{}

	for _, user := range users {
		extendedUsers = append(extendedUsers, struct {
			model.User
			HumanTimestamp string
		}{
			User:           user,
			HumanTimestamp: time.Unix(user.CreatedAt, 0).Format(time.UnixDate),
		})
	}

	params := struct {
		Authenticated bool
		Users         []struct {
			model.User
			HumanTimestamp string
		}
	}{
		Authenticated: ctx.LoggedIn,
		Users:         extendedUsers,
	}

	return ctx.Render(http.StatusOK, "usermanager", params)
}

func (controller *SiteController) RecruiterCreator(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	return ctx.Render(http.StatusOK, "recruitercreator", params)
}

func (controller *SiteController) RecruiterManager(ctx *context.Context) error {
	users, err := controller.svc.User.GetUsers()
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Users",
			"could not get users data",
			err,
		)
	}

	// TODO: Use filtering on GetUsers() instead once implemented
	recruiters := []model.User{}
	for _, user := range users {
		if user.Mark == model.UserMarkRecruiter {
			recruiters = append(recruiters, user)
		}
	}

	params := struct {
		Authenticated bool
		Users         []model.User
	}{
		Authenticated: ctx.LoggedIn,
		Users:         recruiters,
	}

	return ctx.Render(http.StatusOK, "recruitermanager", params)
}

func (controller *SiteController) Intranet(ctx *context.Context) error {
	roles := []string{}

	marksToRole := map[string]string{
		model.UserMarkBasic:     "Basic Member",
		model.UserMarkPaid:      "Paid Member",
		model.UserMarkRecruiter: "Recruiter",
	}

	user, err := controller.svc.User.GetUser(ctx.Username)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting User",
			"could not get user data",
			err,
		)
	}

	markRole, ok := marksToRole[user.Mark]
	if !ok {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Invalid User Mark",
			"could not convert user mark to role",
			fmt.Errorf("invalid user mark: %s", user.Mark),
		)
	}
	roles = append(roles, markRole)

	isTop4, err := controller.svc.Group.VerifyMembership(ctx.Username, model.GroupCommittees, model.GroupTop4)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Membership Verification",
			"could not verify if user was a member of Top4",
			err,
		)
	}
	if isTop4 {
		roles = append(roles, "Top4")
	}

	cards := []struct {
		Title       string
		Description string
		Uri         string
	}{}

	if isTop4 {
		cards = append(cards, struct {
			Title       string
			Description string
			Uri         string
		}{
			Title:       "User Manager",
			Description: "Manage ACM@UIUC's users",
			Uri:         "/intranet/usermanager",
		})
	}

	if isTop4 {
		cards = append(cards, struct {
			Title       string
			Description string
			Uri         string
		}{
			Title:       "Recruiter Manager",
			Description: "Manage ACM@UIUC's recruiters",
			Uri:         "/intranet/recruitermanager",
		})
	}

	if isTop4 {
		cards = append(cards, struct {
			Title       string
			Description string
			Uri         string
		}{
			Title:       "Resume Manager",
			Description: "Manage ACM@UIUC's resumes",
			Uri:         "/intranet/resumemanager",
		})
	}

	params := struct {
		Authenticated bool
		Username      string
		Roles         []string
		Cards         []struct {
			Title       string
			Description string
			Uri         string
		}
	}{
		Authenticated: ctx.LoggedIn,
		Username:      ctx.Username,
		Roles:         roles,
		Cards:         cards,
	}

	return ctx.Render(http.StatusOK, "intranet", params)
}

func (controller *SiteController) ResumeBook(ctx *context.Context) error {
	resumes, err := controller.svc.Resume.GetFilteredResumes(ctx.QueryParams())
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Resumes",
			"could not retrieve resumes",
			err,
		)
	}
	
	approvedResumes := []model.Resume{}
	for _, resume := range resumes {
		if resume.Approved {
			approvedResumes = append(approvedResumes, resume)
		}
	}

	params := struct {
		Authenticated bool
		Resumes       []model.Resume
		model.ResumeOptions
	}{
		Authenticated: ctx.LoggedIn,
		Resumes:       approvedResumes,
		ResumeOptions: model.ResumeValidOptions,
	}

	return ctx.Render(http.StatusOK, "resumebook", params)
}

func (controller *SiteController) ResumeManager(ctx *context.Context) error {
	resumes, err := controller.svc.Resume.GetFilteredResumes(ctx.QueryParams())
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Resumes",
			"could not retrieve resumes",
			err,
		)
	}

	extendedResumes := []struct {
		model.Resume
		HumanTimestamp string
	}{}

	for _, resume := range resumes {
		extendedResumes = append(extendedResumes, struct {
			model.Resume
			HumanTimestamp string
		}{
			Resume:         resume,
			HumanTimestamp: time.Unix(resume.UpdatedAt, 0).Format(time.UnixDate),
		})
	}

	params := struct {
		Authenticated bool
		Resumes       []struct {
			model.Resume
			HumanTimestamp string
		}
		model.ResumeOptions
	}{
		Authenticated: ctx.LoggedIn,
		Resumes:       extendedResumes,
		ResumeOptions: model.ResumeValidOptions,
	}

	return ctx.Render(http.StatusOK, "resumemanager", params)
}

func (controller *SiteController) NotFound(ctx *context.Context) error {
	params := struct {
		Authenticated bool
	}{
		Authenticated: ctx.LoggedIn,
	}

	return ctx.Render(http.StatusNotFound, "notfound", params)
}
