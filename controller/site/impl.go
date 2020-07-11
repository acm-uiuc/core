package site

import (
	"fmt"
	"net/http"
	"strings"
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
	homeUri, err := config.GetConfigValue("HOME_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Home Data",
			"could not get about home uri",
			err,
		)
	}

	home := model.Home{}
	err = controller.svc.Store.ParseInto(homeUri, &home)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Home Data",
			"could not parse home data",
			err,
		)
	}

	params := struct {
		Authenticated bool
		Home          model.Home
	}{
		Authenticated: ctx.LoggedIn,
		Home:          home,
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

	aboutUri, err := config.GetConfigValue("ABOUT_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting About Data",
			"could not get about data uri",
			err,
		)
	}

	about := model.About{}
	err = controller.svc.Store.ParseInto(aboutUri, &about)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting About Data",
			"could not parse about data",
			err,
		)
	}

	params := struct {
		Authenticated bool
		Committees    []model.Group
		About         model.About
	}{
		Authenticated: ctx.LoggedIn,
		Committees:    committees,
		About:         about,
	}

	return ctx.Render(http.StatusOK, "about", params)
}

func (controller *SiteController) History(ctx *context.Context) error {
	aboutUri, err := config.GetConfigValue("ABOUT_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting About Data",
			"could not get about data uri",
			err,
		)
	}

	about := model.About{}
	err = controller.svc.Store.ParseInto(aboutUri, &about)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting About Data",
			"could not parse about data",
			err,
		)
	}

	params := struct {
		Authenticated bool
		History       model.AboutHistory
	}{
		Authenticated: ctx.LoggedIn,
		History:       about.History,
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

	return ctx.Render(http.StatusOK, "event", params)
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

	return ctx.Render(http.StatusOK, "event", params)
}

func (controller *SiteController) HackThis(ctx *context.Context) error {
	eventUri, err := config.GetConfigValue("HACKTHIS_URI")
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

	return ctx.Render(http.StatusOK, "event", params)
}

func (controller *SiteController) Sponsors(ctx *context.Context) error {
	sponsorsUri, err := config.GetConfigValue("SPONSORS_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Sponsor Data",
			"could not get sponsor data uri",
			err,
		)
	}

	sponsors := model.Sponsors{}
	err = controller.svc.Store.ParseInto(sponsorsUri, &sponsors)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Sponsor Data",
			"could not parse sponsor data",
			err,
		)
	}

	params := struct {
		Authenticated bool
		Sponsors      model.Sponsors
	}{
		Authenticated: ctx.LoggedIn,
		Sponsors:      sponsors,
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
	accountExists := false
	if ctx.LoggedIn {
		_, err := controller.svc.User.GetUser(ctx.Username)
		if err == nil {
			accountExists = true
		}
	}

	params := struct {
		Authenticated bool
		AccountExists bool
	}{
		Authenticated: ctx.LoggedIn,
		AccountExists: accountExists,
	}

	return ctx.Render(http.StatusOK, "join", params)
}

func (controller *SiteController) ResumeUpload(ctx *context.Context) error {
	params := struct {
		Authenticated bool
		model.ResumeOptions
	}{
		Authenticated: ctx.LoggedIn,
		ResumeOptions: model.ResumeValidOptions,
	}

	return ctx.Render(http.StatusOK, "resumeupload", params)
}

func (controller *SiteController) UserManager(ctx *context.Context) error {
	users, err := controller.svc.User.GetFilteredUsers(ctx.QueryParams())
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
		MarkOptions []string
	}{
		Authenticated: ctx.LoggedIn,
		Users:         extendedUsers,
		MarkOptions:   model.UserValidMarks,
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
	if !ctx.LoggedIn {
		return ctx.Redirect(http.StatusFound, "/login")
	}

	user, err := controller.svc.User.GetUser(ctx.Username)
	if err != nil {
		return fmt.Errorf("intranet error: %s, redirect error: %w ", err.Error(), ctx.Redirect(http.StatusFound, "/join"))
	}

	roles := []string{}

	marksToRole := map[string]string{
		model.UserMarkBasic:     "Basic Member",
		model.UserMarkPaid:      "Paid Member",
		model.UserMarkRecruiter: "Recruiter",
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

	for _, committee := range model.GroupValidCommittees {
		isMember, err := controller.svc.Group.VerifyMembership(ctx.Username, model.GroupCommittees, committee)
		if err != nil {
			return ctx.RenderError(
				http.StatusBadRequest,
				"Failed Membership Verification",
				fmt.Sprintf("could not verify if user was a member of %s", committee),
				err,
			)
		}
		if isMember {
			roles = append(roles, committee)
		}
	}

	intranetUri, err := config.GetConfigValue("INTRANET_URI")
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Intranet Data",
			"could not get intranet data uri",
			err,
		)
	}

	intranet := model.Intranet{}
	err = controller.svc.Store.ParseInto(intranetUri, &intranet)
	if err != nil {
		return ctx.RenderError(
			http.StatusBadRequest,
			"Failed Getting Intranet Data",
			"could not parse intranet data",
			err,
		)
	}

	checkAccessToCard := func(card model.IntranetCard) (bool, error) {
		for _, mark := range card.Marks {
			if user.Mark == strings.ToUpper(mark) {
				return true, nil
			}
		}

		for _, group := range card.Groups {
			isMember, err := controller.svc.Group.VerifyMembership(ctx.Username, model.GroupCommittees, group)
			if err != nil {
				return false, err
			}
			if isMember {
				return true, nil
			}
		}

		return false, nil
	}

	cards := []model.IntranetCard{}
	for _, card := range intranet.Cards {
		hasAccess, err := checkAccessToCard(card)
		if err != nil {
			return ctx.RenderError(
				http.StatusBadRequest,
				"Failed Checking Card Access",
				fmt.Sprintf("could not verify if user has access to card %s", card.Title),
				err,
			)
		}

		if hasAccess {
			cards = append(cards, card)
		}
	}

	params := struct {
		Authenticated bool
		Username      string
		Roles         []string
		Cards         []model.IntranetCard
		Links         []model.IntranetLink
	}{
		Authenticated: ctx.LoggedIn,
		Username:      ctx.Username,
		Roles:         roles,
		Cards:         cards,
		Links:         intranet.Links,
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
