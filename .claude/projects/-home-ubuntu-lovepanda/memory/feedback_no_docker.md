---
name: no-docker-commands
description: User does not want Docker commands run - do not use docker compose or docker commands
type: feedback
---

Do not run docker, docker compose, or any container-related commands.

**Why:** User explicitly rejected docker compose and told me to stop. They don't want infrastructure/container commands.

**How to apply:** When debugging, only look at source code, config, and build output. Never run docker commands.
