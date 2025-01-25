# ACM @ UIUC Core
This repository is split into multiple parts:
* `src/api/` for the API source code
* `src/ui/` for the UI source code
* `src/common/` for common modules between the API and the UI (such as constants, types, errors, etc.)

## Getting Started
You will need node>=22 installed, as well as the AWS CLI and the AWS SAM CLI. The best way to work with all of this is to open the environment in a container within your IDE (VS Code should prompt you to do so: use "Clone in Container" for best performance). This container will have all needed software installed.

Then, run `make install` to install all packages, and `make local` to start the UI and API servers! The UI will be accessible on `http://localhost:5173/` and the API on `http://localhost:8080/`.

**Note: there is currently a known performance issue with running the UI development server in a container. If your requests are timing out, try going to `src/ui` and running `yarn preview` to generate a non development server build.**
