package user

import (
	"fmt"

	"github.com/jmoiron/sqlx"

	"github.com/acm-uiuc/core/model"
)

type userImpl struct {
	db *sqlx.DB
}

func (service *userImpl) GetUser(username string) (*model.User, error) {
	user, err := service.getUser(username)
	if err != nil {
		return nil, fmt.Errorf("failed to get info: %w", err)
	}

	if user.Username == "" {
		return nil, fmt.Errorf("failed to get info: %s", username)
	}

	return user, nil
}

func (service *userImpl) CreateUser(user model.User) error {
	err := service.validateUser(&user)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	err = service.addUser(&user)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

func (service *userImpl) GetUsers() ([]model.User, error) {
	users, err := service.getUsers()
	if err != nil {
		return nil, fmt.Errorf("failed to get infos: %w", err)
	}

	return users, nil
}

func (service *userImpl) MarkUser(username string, mark string) error {
	err := service.validateMark(mark)
	if err != nil {
		return fmt.Errorf("failed to mark user: %w", err)
	}

	err = service.setMark(username, mark)
	if err != nil {
		return fmt.Errorf("failed to mark user: %w", err)
	}

	return nil
}

func (service *userImpl) DeleteUser(username string) error {
	err := service.removeUser(username)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

func (service *userImpl) validateUser(user *model.User) error {
	if user.Mark != model.UserMarkBasic {
		return fmt.Errorf("invalid user mark: %s", user.Mark)
	}

	if user.Username == "" {
		return fmt.Errorf("invalid username: %s", user.Username)
	}

	// TODO: Implement further user data validate

	return nil
}

func (service *userImpl) addUser(user *model.User) error {
	_, err := service.db.NamedExec("INSERT INTO users (username, first_name, last_name, mark, created_at) VALUES (:username, :first_name, :last_name, :mark, :created_at)", user)
	if err != nil {
		return fmt.Errorf("failed to add user to database: %w", err)
	}

	return nil
}

func (service *userImpl) removeUser(username string) error {
	user := &model.User{
		Username: username,
	}

	_, err := service.db.NamedExec("DELETE FROM users WHERE username = :username", user)
	if err != nil {
		return fmt.Errorf("failed to remove user from database: %w", err)
	}

	return nil
}

func (service *userImpl) getUser(username string) (*model.User, error) {
	user := &model.User{
		Username: username,
	}

	rows, err := service.db.NamedQuery("SELECT * FROM users WHERE username=:username", user)
	if err != nil {
		return nil, fmt.Errorf("failed to query database for user: %w", err)
	}

	result := &model.User{}
	for rows.Next() {
		err := rows.StructScan(result)
		if err != nil {
			return nil, fmt.Errorf("failed to decode row from database: %w", err)
		}
	}

	err = rows.Err()
	if err != nil {
		return nil, fmt.Errorf("failed reading rows from database: %w", err)
	}

	return result, nil
}

func (service *userImpl) getUsers() ([]model.User, error) {
	rows, err := service.db.NamedQuery("SELECT * FROM users", struct{}{})
	if err != nil {
		return nil, fmt.Errorf("failed to query database for users: %w", err)
	}

	results := []model.User{}
	for rows.Next() {
		result := model.User{}
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

	return results, nil
}

func (service *userImpl) validateMark(mark string) error {
	for _, validMark := range model.UserValidMarks {
		if mark == validMark {
			return nil
		}
	}

	return fmt.Errorf("invalid mark: %s", mark)
}

func (service *userImpl) setMark(username string, mark string) error {
	user := &model.User{
		Username: username,
		Mark:     mark,
	}

	_, err := service.db.NamedExec("UPDATE users SET mark=:mark WHERE username=:username", user)
	if err != nil {
		return fmt.Errorf("failed to update mark: %w", err)
	}

	return nil
}
