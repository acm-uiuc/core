package user_test

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/acm-uiuc/core/database"
	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service/user"
)

func setupTest() error {
	db, err := database.New()
	if err != nil {
		return fmt.Errorf("failed to get database handle: %w", err)
	}

	_, err = db.Exec("DELETE FROM users")
	if err != nil {
		return fmt.Errorf("failed to clean table: %w", err)
	}

	return nil

}

func TestCreateAndGetUser(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := user.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedUser := model.User{
		Username:  "fake",
		FirstName: "fake",
		LastName:  "fake",
		Mark:      model.UserMarkBasic,
		CreatedAt: 10,
	}

	err = svc.CreateUser(expectedUser)
	if err != nil {
		t.Fatal(err)
	}

	user, err := svc.GetUser(expectedUser.Username)
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(&expectedUser, user) {
		t.Fatalf("expected '%+v', got '%+v'", &expectedUser, user)
	}
}

func TestCreateAndGetUsers(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := user.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedUserOne := model.User{
		Username:  "fake1",
		FirstName: "fake1",
		LastName:  "fake1",
		Mark:      model.UserMarkBasic,
		CreatedAt: 10,
	}

	expectedUserTwo := model.User{
		Username:  "fake2",
		FirstName: "fake2",
		LastName:  "fake2",
		Mark:      model.UserMarkBasic,
		CreatedAt: 20,
	}

	err = svc.CreateUser(expectedUserOne)
	if err != nil {
		t.Fatal(err)
	}

	err = svc.CreateUser(expectedUserTwo)
	if err != nil {
		t.Fatal(err)
	}

	users, err := svc.GetUsers()
	if err != nil {
		t.Fatal(err)
	}

	expectedCount := 2
	if len(users) != expectedCount {
		t.Fatalf("expected '%d', got '%d'", expectedCount, len(users))
	}

	if !((reflect.DeepEqual(expectedUserOne, users[0]) && reflect.DeepEqual(expectedUserTwo, users[1])) || (reflect.DeepEqual(expectedUserOne, users[1]) && reflect.DeepEqual(expectedUserTwo, users[0]))) {
		t.Fatalf("expected '%+v' and '%+v', got '%+v' and '%+v'", expectedUserOne, expectedUserTwo, users[0], users[1])
	}
}

func TestCreateAndMarkAndGetUser(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := user.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedUser := model.User{
		Username:  "fake",
		FirstName: "fake",
		LastName:  "fake",
		Mark:      model.UserMarkBasic,
		CreatedAt: 10,
	}

	err = svc.CreateUser(expectedUser)
	if err != nil {
		t.Fatal(err)
	}

	user, err := svc.GetUser(expectedUser.Username)
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(&expectedUser, user) {
		t.Fatalf("expected '%+v', got '%+v'", &expectedUser, user)
	}

	err = svc.MarkUser(expectedUser.Username, model.UserMarkPaid)
	if err != nil {
		t.Fatal(err)
	}

	expectedUser.Mark = model.UserMarkPaid

	user, err = svc.GetUser(expectedUser.Username)
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(&expectedUser, user) {
		t.Fatalf("expected '%+v', got '%+v'", &expectedUser, user)
	}
}

func TestCreateAndGetAndRemoveAndGetUser(t *testing.T) {
	err := setupTest()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := user.New()
	if err != nil {
		t.Fatal(err)
	}

	expectedUser := model.User{
		Username:  "fake",
		FirstName: "fake",
		LastName:  "fake",
		Mark:      model.UserMarkBasic,
		CreatedAt: 10,
	}

	err = svc.CreateUser(expectedUser)
	if err != nil {
		t.Fatal(err)
	}

	user, err := svc.GetUser(expectedUser.Username)
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(&expectedUser, user) {
		t.Fatalf("expected '%+v', got '%+v'", &expectedUser, user)
	}

	err = svc.DeleteUser(expectedUser.Username)
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.GetUser(expectedUser.Username)
	if err == nil {
		t.Fatal("expected no user")
	}
}
