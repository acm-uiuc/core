package resume

import (
	"fmt"

	"github.com/jmoiron/sqlx"

	"github.com/acm-uiuc/core/config"
	"github.com/acm-uiuc/core/database/querybuilder"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service/resume/provider"
)

const (
	signerParallelism = 8
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
	resumes, err := service.getFilteredResumes(map[string][]string{})
	if err != nil {
		return nil, fmt.Errorf("failed to get resumes: %w", err)
	}

	return resumes, nil
}

func (service *resumeImpl) GetFilteredResumes(filters map[string][]string) ([]model.Resume, error) {
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
		return fmt.Errorf("resume blob key should be the username: %s", resume.BlobKey)
	}

	return nil
}

func (service *resumeImpl) addResume(resume *model.Resume) error {
	_, err := service.db.NamedExec("INSERT INTO resumes (username, first_name, last_name, email, graduation_month, graduation_year, major, degree, seeking, blob_key, approved, updated_at) VALUES (:username, :first_name, :last_name, :email, :graduation_month, :graduation_year, :major, :degree, :seeking, :blob_key, :approved, :updated_at) ON DUPLICATE KEY UPDATE username = :username, first_name = :first_name, last_name = :last_name, email = :email, graduation_month = :graduation_month, graduation_year = :graduation_year, major = :major, degree = :degree, seeking = :seeking, blob_key = :blob_key, approved = :approved, updated_at = :updated_at", resume)
	if err != nil {
		return fmt.Errorf("failed to add resume to database: %w", err)
	}

	return nil
}

func (service *resumeImpl) getFilteredResumes(filterStrings map[string][]string) ([]model.Resume, error) {
	query, args, err := querybuilder.FilterQuery("SELECT * FROM resumes", filterStrings, model.Resume{})
	if err != nil {
		return nil, fmt.Errorf("failed to construct query with appropriate filters: %w", err)
	}

	rows, err := service.db.NamedQuery(query, args)
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

		results = append(results, result)
	}

	err = rows.Err()
	if err != nil {
		return nil, fmt.Errorf("failed reading rows from database: %w", err)
	}

	signerInputs := make(chan int, len(results))
	signerOutputs := make(chan error, len(results))

	signerWorker := func(inputs <-chan int, outputs chan<- error) {
		for input := range inputs {
			uri, err := service.getSignedUri(results[input].BlobKey, "GET")
			results[input].BlobKey = uri
			outputs <- err
		}
	}

	for i := 0; i < signerParallelism; i++ {
		go signerWorker(signerInputs, signerOutputs)
	}

	for i := 0; i < len(results); i++ {
		signerInputs <- i
	}
	close(signerInputs)

	var firstError error
	for i := 0; i < len(results); i++ {
		err := <-signerOutputs
		if firstError == nil && err != nil {
			firstError = err
		}
	}
	close(signerOutputs)

	if firstError != nil {
		return nil, fmt.Errorf("failed to generate signed uri for resume: %w", firstError)
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
