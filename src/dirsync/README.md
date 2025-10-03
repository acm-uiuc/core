# Entra ID to Google Workspace External Contact Sync


# Creating certificates
```bash
openssl req -x509 -newkey rsa:2048 -keyout private-key.pem -out certificate.pem -days 7350 -nodes -subj "/CN=DirSync"
cat private-key.pem certificate.pem > combined.pem
base64 -i combined.pem -o combined-base64.txt
```

Upload `certificate.pem` to Azure, and the contents of `combined-base64.txt` to Secrets Manager.
