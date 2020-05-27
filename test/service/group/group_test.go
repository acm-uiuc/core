package group_test

import (
	"reflect"
	"testing"

	"github.com/acm-uiuc/core/model"
	"github.com/acm-uiuc/core/service/group"
)

func TestGetGroups(t *testing.T) {
	svc, err := group.New()
	if err != nil {
		t.Fatal(err)
	}

	groups, err := svc.GetGroups()
	if err != nil {
		t.Fatal(err)
	}

	expectedGroupTypeCount := 2
	if len(groups) != expectedGroupTypeCount {
		t.Fatalf("expected '%d', got '%d'", expectedGroupTypeCount, len(groups))
	}

	committees, ok := groups[model.GroupCommittees]
	if !ok {
		t.Fatalf("couldn't find group type: %s", model.GroupCommittees)
	}

	expected := model.Group{
		Name:        "Top4",
		Description: "The leadership team for ACM@UIUC",
		Chairs:      "Arnav Sankaran",
		Email:       "acm@illinois.edu",
		Members: []model.GroupMember{
			model.GroupMember{
				Role:        "Chair",
				Username:    "arnavs3",
				DisplayName: "Arnav Sankaran",
				Email:       "acm@illinois.edu",
			},
			model.GroupMember{
				Role:        "Vice Chair",
				Username:    "asdale2",
				DisplayName: "Asher Dale",
				Email:       "vice-chair@acm.illinois.edu",
			},
			model.GroupMember{
				Role:        "Treasurer",
				Username:    "mpj4",
				DisplayName: "Martin Juskelis",
				Email:       "treasurer@acm.illinois.edu",
			},
			model.GroupMember{
				Role:        "Secretary",
				Username:    "devyesh2",
				DisplayName: "Dev Satpathy",
				Email:       "secretary@acm.illinois.edu",
			},
		},
	}

	if !reflect.DeepEqual(expected, committees[0]) {
		t.Fatalf("expected '%+v', got '%+v'", expected, committees[0])
	}
}

func TestVerifyMembership(t *testing.T) {
	svc, err := group.New()
	if err != nil {
		t.Fatal(err)
	}

	username := "arnavs3"
	isMember, err := svc.VerifyMembership(username, model.GroupCommittees, model.GroupTop4)
	if err != nil {
		t.Fatal(err)
	}

	expected := true
	if isMember != expected {
		t.Fatalf("expect '%t', got '%t'", expected, isMember)
	}

	username = "fake"
	isMember, err = svc.VerifyMembership(username, model.GroupCommittees, model.GroupTop4)
	if err != nil {
		t.Fatal(err)
	}

	expected = false
	if isMember != expected {
		t.Fatalf("expect '%t', got '%t'", expected, isMember)
	}
}
