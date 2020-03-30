package gitstore

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"time"

	"gopkg.in/yaml.v2"

	"github.com/acm-uiuc/core/config"
)

const (
	dataTTL = 15
)

type gitStoreImpl struct {
	basePath string
	data     map[string]*gitStoreBlob
}

type gitStoreBlob struct {
	data        []byte
	lastUpdated int64
}

func (store *gitStoreImpl) ParseInto(pathKey string, out interface{}) error {
	blob, ok := store.data[pathKey]
	if !ok {
		store.data[pathKey] = &gitStoreBlob{
			data:        []byte{},
			lastUpdated: 0,
		}

		err := store.refreshData()
		if err != nil {
			return fmt.Errorf("invalid pathKey: %w", err)
		}
	}

	blob, ok = store.data[pathKey]
	if !ok {
		return fmt.Errorf("invalid pathKey: %s", pathKey)
	}

	err := yaml.Unmarshal(blob.data, out)
	if err != nil {
		return fmt.Errorf("failed to unmarshal raw data: %w", err)
	}

	return nil
}

func (store *gitStoreImpl) refreshData() error {
	for pathKey, blob := range store.data {
		if blob.lastUpdated > time.Now().Add(-1*dataTTL*time.Minute).Unix() {
			continue
		}

		uri := store.basePath + pathKey

		isDev, err := config.GetConfigValue("IS_DEV")
		if err != nil {
			return fmt.Errorf("failed to get config value: %w", err)
		}

		data := []byte{}
		if isDev != "true" {
			resp, err := http.Get(uri)
			if err != nil {
				return fmt.Errorf("failed to retrieve data: %w", err)
			}

			defer resp.Body.Close()

			data, err = ioutil.ReadAll(resp.Body)
			if err != nil {
				return fmt.Errorf("failed to read raw data: %w", err)
			}
		} else {
			data, err = ioutil.ReadFile(uri)
			if err != nil {
				return fmt.Errorf("failed to read raw data: %w", err)
			}
		}

		store.data[pathKey].data = data
		store.data[pathKey].lastUpdated = time.Now().Unix()
	}

	return nil
}
