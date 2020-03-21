package provider

type FakeOAuth struct{}

func (oauth *FakeOAuth) GetOAuthRedirect(target string) (string, error) {
	return "http://fake.oauth", nil
}

func (oauth *FakeOAuth) GetOAuthToken(code string) (string, error) {
	return "fake_token", nil
}

func (oauth *FakeOAuth) GetVerifiedEmail(token string) (string, error) {
	return "fake@illinois.edu", nil
}
