package resume

import (
	"fmt"
	"reflect"
	"strconv"

	"github.com/jmoiron/sqlx"

	"github.com/acm-uiuc/core/config"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service/resume/provider"
)

type resumeImpl struct {
	db *sqlx.DB
}

func (service *resumeImpl) UploadResume(resume model.Resume) (string, error) {
	err := service.validateResume(&resume)
	if err != nil {
		return "", fmt.Errorf("failed to create resume: %w", err)
	}

	err = service.addResume(&resume)
	if err != nil {
		return "", fmt.Errorf("failed to create resume: %w", err)
	}

	signedUri, err := service.getSignedUri(resume.BlobKey, "PUT")
	if err != nil {
		return "", fmt.Errorf("failed to create signed uri: %w", err)
	}

	return signedUri, nil
}

func (service *resumeImpl) GetResumes() ([]model.Resume, error) {
	resumes, err := service.getFilteredResumes(make(map[string]string))
	if err != nil {
		return nil, fmt.Errorf("failed to get resumes: %w", err)
	}

	return resumes, nil
}

func (service *resumeImpl) GetFilteredResumes(filters map[string]string) ([]model.Resume, error) {
	resumes, err := service.getFilteredResumes(filters)
	if err != nil {
		return nil, fmt.Errorf("failed to get filtered resumes: %w", err)
	}

	return resumes, nil
}

func (service *resumeImpl) ApproveResume(username string) error {
	err := service.markApproved(username)
	if err != nil {
		return fmt.Errorf("failed to approve resume: %w", err)
	}

	return nil
}

func (service *resumeImpl) validateResume(resume *model.Resume) error {
	if resume.Approved {
		return fmt.Errorf("resume should not be approved")
	}

	if resume.BlobKey != resume.Username {
		return fmt.Errorf("resume blob key should be the username: %w", resume.BlobKey)
	}

	// TODO: Enforce more validation on resumes

	return nil
}

func (service *resumeImpl) addResume(resume *model.Resume) error {
	_, err := service.db.NamedExec("INSERT INTO resumes (username, first_name, last_name, email, graduation_month, graduation_year, major, degree, seeking, blob_key, approved, updated_at) VALUES (:username, :first_name, :last_name, :email, :graduation_month, :graduation_year, :major, :degree, :seeking, :blob_key, :approved, :updated_at) ON DUPLICATE KEY UPDATE username = :username, first_name = :first_name, last_name = :last_name, email = :email, graduation_month = :graduation_month, graduation_year = :graduation_year, major = :major, degree = :degree, seeking = :seeking, blob_key = :blob_key, approved = :approved, updated_at = :updated_at", resume)
	if err != nil {
		return fmt.Errorf("failed to add resume to database: %w", err)
	}

	return nil
}

func (service *resumeImpl) getFilteredResumes(filterStrings map[string]string) ([]model.Resume, error) {
	filters := make(map[string]interface{})
	query := "SELECT * FROM resumes WHERE 1=1"
	resumeModel := reflect.ValueOf(model.Resume{})
	for i := 0; i < resumeModel.NumField(); i++ {
		filterKey := resumeModel.Type().Field(i).Tag.Get("db")
		if filterString, ok := filterStrings[filterKey]; ok {
			var filter interface{}
			var err error
			switch resumeModel.Field(i).Interface().(type) {
			case string:
				filter = filterString
			case int:
				filter, err = strconv.Atoi(filterString)
			case int64:
				filter, err = strconv.ParseInt(filterString, 10, 64)
			case bool:
				filter, err = strconv.ParseBool(filterString)
			}

			if err != nil {
				return nil, fmt.Errorf("invalid filter type for field '%v': %w", filterKey, err)
			}
			filters[filterKey] = filter
			query += fmt.Sprintf(" AND %[1]v = :%[1]v", filterKey) // e.g. " AND username = :username"
		}
	}

	rows, err := service.db.NamedQuery(query, filters)
	if err != nil {
		return nil, fmt.Errorf("failed to query database for resumes: %w", err)
	}

	results := []model.Resume{}
	for rows.Next() {
		result := model.Resume{}
		err := rows.StructScan(&result)
		if err != nil {
			return nil, fmt.Errorf("failed to decode row from database: %w", err)
		}

		uri, err := service.getSignedUri(result.BlobKey, "GET")
		if err != nil {
			return nil, fmt.Errorf("failed to generate signed uri for resume: %w", err)
		}
		result.BlobKey = uri

		results = append(results, result)
	}

	err = rows.Err()
	if err != nil {
		return nil, fmt.Errorf("failed reading rows from database: %w", err)
	}

	return results, nil
}

func (service *resumeImpl) getSignedUri(blobKey string, method string) (string, error) {
	providerName, err := config.GetConfigValue("STORAGE_PROVIDER")
	if err != nil {
		return "", fmt.Errorf("failed to get storage provider name: %w", err)
	}

	stoageProvider, err := provider.GetProvider(providerName)
	if err != nil {
		return "", fmt.Errorf("failed to get storage provider: %w", err)
	}

	return stoageProvider.GetSignedUri(blobKey, method)
}

func (service *resumeImpl) markApproved(username string) error {
	resume := &model.Resume{
		Username: username,
		Approved: true,
	}

	_, err := service.db.NamedExec("UPDATE resumes SET approved=:approved WHERE username=:username", resume)
	if err != nil {
		return fmt.Errorf("failed to update resume: %w", err)
	}

	return nil
}
