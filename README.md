# Core
Core is a replacement for the core services in ACM@UIUC's current generation of infrastructure. Core is intended to be small and provide only the minimal set of functionality to run ACM@UIUC's website and membership managment. All other additional features should be implemented as microservices which can rely on Core for authentication and memberhip verification.

## Design
The design for Core is detailed in `design.md`. This file covers how Core is organized, the routes exposed by Core, and the structure of the data stored by Core.

## Deployment
The deployment for Core is detailed in `deployment.md`. This file covers how Core the code in this repository is continuously tested and deployed to the production environment. Note that the latest commit to the master branch is always immediately deployed to production.

## Development
The documentation for developing Core can be found in `development.md`.

## Extension Development
The documentation for building extensions can be found in `extensions.md`.

## License
The license for this repository can be found in `LICENSE`.
