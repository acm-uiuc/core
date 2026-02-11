# ACM @ UIUC Core
This repository is split into multiple parts:
* `src/api/` for the API source code
* `src/ui/` for the UI source code
* `src/common/` for shared modules between the API and the UI (constants, types, errors, etc.)
* `src/archival/` for the DynamoDB data archival Lambda
* `src/linkryEdgeFunction/` for the CloudFront edge function powering the acm.gg link shortener

## Getting Started
You will need Node.js >=24 <25 installed, as well as Yarn 1.22.x. The recommended setup is to develop natively on macOS/Linux or via WSL on Windows.

> A VS Code dev container (`.devcontainer/`) exists as an alternative, but native or WSL is preferred for performance and reliability.

Run `make install` to install all packages, and `make local` to start the UI and API servers. The UI will be accessible on `http://localhost:5173/` and the API on `http://localhost:8080/`.

For the full development guide (environment setup, testing, deployment, and more), see the **[Wiki](https://github.com/acm-uiuc/core/wiki)**.
