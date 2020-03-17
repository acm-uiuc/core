package provider

import (
	"context"
	"fmt"
	"time"

	credentials "cloud.google.com/go/iam/credentials/apiv1"
	googleStorage "cloud.google.com/go/storage"
	credentialspb "google.golang.org/genproto/googleapis/iam/credentials/v1"

	"github.com/acm-uiuc/core/config"
)

const (
	signedUriLifetime = 60
)

type GoogleStorage struct{}

func (storage *GoogleStorage) GetSignedUri(blobKey string, method string) (string, error) {
	serviceAccount, err := config.GetConfigValue("GOOGLE_SERVICE_ACCOUNT")
	if err != nil {
		return "", fmt.Errorf("failed to get google service account name: %w", err)
	}

	bucketName, err := config.GetConfigValue("GOOGLE_BUCKET_NAME")
	if err != nil {
		return "", fmt.Errorf("failed to get google bucket name: %w", err)
	}

	ctx := context.Background()

	credentialClient, err := credentials.NewIamCredentialsClient(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create credential client: %w", err)
	}

	signingOpts := &googleStorage.SignedURLOptions{
		Method:         method,
		GoogleAccessID: serviceAccount,
		SignBytes: func(payload []byte) ([]byte, error) {
			req := &credentialspb.SignBlobRequest{
				Payload: payload,
				Name:    serviceAccount,
			}

			resp, err := credentialClient.SignBlob(ctx, req)
			if err != nil {
				return nil, fmt.Errorf("failed to sign blob: %w", err)
			}

			return resp.SignedBlob, nil
		},
		Expires:     time.Now().Add(signedUriLifetime * time.Minute),
		ContentType: "application/pdf",
	}

	signedUri, err := googleStorage.SignedURL(bucketName, blobKey, signingOpts)
	if err != nil {
		return "", fmt.Errorf("failed to sign url: %w", err)
	}

	return signedUri, nil
}
