# Shortcuts for the npm scripts. `make dev` is the one you need day to day.
.DEFAULT_GOAL := help

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

.env:
	cp .env.example .env
	@echo "Created .env: add your TELEGRAM_BOT_TOKEN, then run make dev again." && exit 1

.PHONY: help dev start fetch jobs rescore typecheck cv

help: ## List the commands
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

dev: node_modules .env ## Bot + scheduler, restarting when src/, config.yaml or the profile change
	npm run dev

start: node_modules .env ## Bot + scheduler (no auto-restart)
	npm start

fetch: node_modules ## Collect, dedupe and score new jobs now
	npm run fetch

jobs: node_modules ## Best open matches (make jobs SOURCE=linkedin, ALL=1 to include restricted)
	npm run jobs -- --limit 40 $(if $(SOURCE),--source $(SOURCE)) $(if $(ALL),--all)

rescore: node_modules ## Re-score stored jobs after editing config.yaml or the profile
	npm run rescore

cv: node_modules ## Tailored CV for a stored job: make cv ID=86
	@test -n "$(ID)" || (echo "Usage: make cv ID=<job id>" && exit 1)
	npm run cv -- $(ID)

typecheck: node_modules ## Type-check the code
	npx tsc
