# Architecture

Our system uses a modular plugin-based architecture with clear separation of concerns.

## Database Layer

We use PostgreSQL for persistent storage with connection pooling via pgBouncer. All queries go through a repository pattern that abstracts direct SQL access.

## API Layer

REST endpoints built with Express.js and documented via OpenAPI. Each route handler delegates to a service layer that contains business logic.

## Authentication

JWT-based authentication with short-lived access tokens and rotating refresh tokens. Passwords are hashed with bcrypt. OAuth2 is supported for Google and GitHub.

## Deployment

Docker containers orchestrated by Kubernetes. Blue-green deployments with automated rollback on health check failures.
