package config

import (
	"fmt"
	"os"
)

var defaultConfig = map[string]string{
	"DB_USER":                     "devuser",
	"DB_PASS":                     "devpass",
	"DB_HOST":                     "(localhost:3306)",
	"DB_NAME":                     "core",
	"GITSTORE_BASE_URI":           "https://raw.githubusercontent.com/acm-uiuc/core/master/data/",
	"GROUP_URI":                   "groups.yaml",
	"HACKILLINOIS_URI":            "hackillinois.yaml",
	"REFLECTIONSPROJECTIONS_URI":  "reflectionsprojections.yaml",
	"INTRANET_URI":                "intranet.yaml",
	"SPONSORS_URI":                "sponsors.yaml",
	"ABOUT_URI":                   "about.yaml",
	"HOME_URI":                    "home.yaml",
	"IS_TEST":                     "false",
	"IS_DEV":                      "false",
	"TEMPLATE_SRCS":               "template/*.html",
	"STATIC_BASE":                 "static/",
	"OAUTH_GOOGLE_REDIRECT_URI":   "http://localhost:8000/api/auth/google/redirect",
	"OAUTH_LINKEDIN_REDIRECT_URI": "http://localhost:8000/api/auth/linkedin/redirect",
	"OAUTH_GOOGLE_ID":             "",
	"OAUTH_GOOGLE_SECRET":         "",
	"OAUTH_LINKEDIN_ID":           "",
	"OAUTH_LINKEDIN_SECRET":       "",
	"STORAGE_PROVIDER":            "google",
	"GOOGLE_BUCKET_NAME":          "acm-core-resume",
	"GOOGLE_SERVICE_ACCOUNT":      "",
	"OAUTH_FAKE_USER":             "fake@illinois.edu",
}

func GetConfigValue(key string) (string, error) {
	value, ok := os.LookupEnv(key)
	if ok {
		return value, nil
	}

	value, ok = defaultConfig[key]
	if !ok {
		return "", fmt.Errorf("failed to find config key: %s", key)
	}

	return value, nil
}
