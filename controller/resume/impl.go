package resume

import (
	"net/http"
	"time"

	"github.com/acm-uiuc/core/context"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service"
)

type ResumeController struct {
	svc *service.Service
}

func New(svc *service.Service) *ResumeController {
	return &ResumeController{
		svc: svc,
	}
}

func (controller *ResumeController) UploadResume(ctx *context.Context) error {
	req := model.Resume{}

	err := ctx.Bind(&req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Bind",
			"malformed request",
			err,
		)
	}

	req.BlobKey = req.Username
	req.Approved = false
	req.UpdatedAt = time.Now().Unix()

	uri, err := controller.svc.Resume.UploadResume(req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Resume Upload",
			"could not upload metadata or get file upload uri",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, &struct {
		UploadUri string `json:"upload_uri"`
	}{
		UploadUri: uri,
	})
}

func (controller *ResumeController) GetResumes(ctx *context.Context) error {
	resumes, err := controller.svc.Resume.GetResumes()
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Resumes Lookup",
			"could not retrieve resume metadata",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, resumes)
}

func (controller *ResumeController) ApproveResume(ctx *context.Context) error {
	req := model.Resume{}

	err := ctx.Bind(&req)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Bind",
			"malformed request",
			err,
		)
	}

	err = controller.svc.Resume.ApproveResume(req.Username)
	if err != nil {
		return ctx.JSONError(
			http.StatusBadRequest,
			"Failed Resumes Approval",
			"could not mark resume as approved",
			err,
		)
	}

	return ctx.JSON(http.StatusOK, struct{}{})
}
