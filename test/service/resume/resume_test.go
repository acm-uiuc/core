package resume_test

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/acm-uiuc/core/database"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service/resume"
)

func setupTest() error {
	db, err := database.New()
	if err != nil {
		return fmt.Errorf("failed to get database handle: %w", err)
	}

	_, err = db.Exec("DELETE FROM resumes")
	if err != nil {
		return fmt.Errorf("failed to clean table: %w", err)
	}

	return nil

}

func TestCreateAndGetresumes(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := resume.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedResumeOne := model.Resume{
		Username:        "fake1",
		FirstName:       "fake1",
		LastName:        "fake1",
		Email:           "fake1@illinois.edu",
		GraduationMonth: 5,
		GraduationYear:  2021,
		Major:           "Computer Science",
		Degree:          "Bachelors",
		Seeking:         "Full Time",
		BlobKey:         "fake1",
		Approved:        false,
		UpdatedAt:       10,
	}

	expectedResumeTwo := model.Resume{
		Username:        "fake2",
		FirstName:       "fake2",
		LastName:        "fake2",
		Email:           "fake2@illinois.edu",
		GraduationMonth: 5,
		GraduationYear:  2022,
		Major:           "Computer Engineering",
		Degree:          "Masters",
		Seeking:         "Internship",
		BlobKey:         "fake2",
		Approved:        false,
		UpdatedAt:       20,
	}

	_, err = svc.UploadResume(expectedResumeOne)
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.UploadResume(expectedResumeTwo)
	if err != nil {
		t.Fatal(err)
	}

	resumes, err := svc.GetResumes()
	if err != nil {
		t.Fatal(err)
	}

	expectedCount := 2
	if len(resumes) != expectedCount {
		t.Fatalf("expected '%d', got '%d'", expectedCount, len(resumes))
	}

	expectedResumeOne.BlobKey = "http://fakestorage.local"
	expectedResumeTwo.BlobKey = "http://fakestorage.local"

	if !((reflect.DeepEqual(expectedResumeOne, resumes[0]) && reflect.DeepEqual(expectedResumeTwo, resumes[1])) || (reflect.DeepEqual(expectedResumeOne, resumes[1]) && reflect.DeepEqual(expectedResumeTwo, resumes[0]))) {
		t.Fatalf("expected '%+v' and '%+v', got '%+v' and '%+v'", expectedResumeOne, expectedResumeTwo, resumes[0], resumes[1])
	}
}

func TestCreateAndApproveAndGetresume(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := resume.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedResumeOne := model.Resume{
		Username:        "fake1",
		FirstName:       "fake1",
		LastName:        "fake1",
		Email:           "fake1@illinois.edu",
		GraduationMonth: 5,
		GraduationYear:  2021,
		Major:           "Computer Science",
		Degree:          "Bachelors",
		Seeking:         "Full Time",
		BlobKey:         "fake1",
		Approved:        false,
		UpdatedAt:       10,
	}

	_, err = svc.UploadResume(expectedResumeOne)
	if err != nil {
		t.Fatal(err)
	}

	err = svc.ApproveResume(expectedResumeOne.Username)
	if err != nil {
		t.Fatal(err)
	}

	resumes, err := svc.GetResumes()
	if err != nil {
		t.Fatal(err)
	}

	expectedCount := 1
	if len(resumes) != expectedCount {
		t.Fatalf("expected '%d', got '%d'", expectedCount, len(resumes))
	}

	expectedResumeOne.Approved = true
	expectedResumeOne.BlobKey = "http://fakestorage.local"

	if !reflect.DeepEqual(expectedResumeOne, resumes[0]) {
		t.Fatalf("expected '%+v', got '%+v'", expectedResumeOne, resumes[0])
	}
}

func TestCreateAndGetFilteredResumes(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := resume.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedResumeOne := model.Resume{
		Username:        "fake1",
		FirstName:       "fake1",
		LastName:        "fake1",
		Email:           "fake1@illinois.edu",
		GraduationMonth: 5,
		GraduationYear:  2021,
		Major:           "Computer Science",
		Degree:          "Bachelors",
		Seeking:         "Full Time",
		BlobKey:         "fake1",
		Approved:        false,
		UpdatedAt:       10,
	}

	expectedResumeTwo := model.Resume{
		Username:        "fake2",
		FirstName:       "fake2",
		LastName:        "fake2",
		Email:           "fake2@illinois.edu",
		GraduationMonth: 5,
		GraduationYear:  2022,
		Major:           "Computer Engineering",
		Degree:          "Masters",
		Seeking:         "Internship",
		BlobKey:         "fake2",
		Approved:        false,
		UpdatedAt:       20,
	}

	_, err = svc.UploadResume(expectedResumeOne)
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.UploadResume(expectedResumeTwo)
	if err != nil {
		t.Fatal(err)
	}

	expectedResumeOne.BlobKey = "http://fakestorage.local"
	expectedResumeTwo.BlobKey = "http://fakestorage.local"

	t.Run("no filters", func(t *testing.T) {
		filters := map[string][]string{}
		resumes, err := svc.GetFilteredResumes(filters)
		if err != nil {
			t.Fatal(err)
		}

		expectedCount := 2
		if len(resumes) != expectedCount {
			t.Fatalf("expected '%d', got '%d'", expectedCount, len(resumes))
		}
	})

	t.Run("filter by string values", func(t *testing.T) {
		filters := map[string][]string{
			"seeking": {"Internship"},
			"major":   {"Computer Engineering"},
		}

		resumes, err := svc.GetFilteredResumes(filters)
		if err != nil {
			t.Fatal(err)
		}

		expectedCount := 1
		if len(resumes) != expectedCount {
			t.Fatalf("expected '%d', got '%d'", expectedCount, len(resumes))
		}

		if !reflect.DeepEqual(expectedResumeTwo, resumes[0]) {
			t.Fatalf("expected '%+v', got '%+v'", expectedResumeTwo, resumes[0])
		}
	})

	t.Run("filter by integer values", func(t *testing.T) {
		filters := map[string][]string{
			"graduation_year": {"2021"},
		}

		resumes, err := svc.GetFilteredResumes(filters)
		if err != nil {
			t.Fatal(err)
		}

		expectedCount := 1
		if len(resumes) != expectedCount {
			t.Fatalf("expected '%d', got '%d'", expectedCount, len(resumes))
		}

		if !reflect.DeepEqual(expectedResumeOne, resumes[0]) {
			t.Fatalf("expected '%+v', got '%+v'", expectedResumeOne, resumes[0])
		}
	})

	t.Run("filter with no expected results", func(t *testing.T) {
		filters := map[string][]string{
			"username": {"fake3"},
		}

		resumes, err := svc.GetFilteredResumes(filters)
		if err != nil {
			t.Fatal(err)
		}

		expectedCount := 0
		if len(resumes) != expectedCount {
			t.Fatalf("expected '%d', got '%d'", expectedCount, len(resumes))
		}
	})
}
