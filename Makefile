PLUGIN  := net.roxl.joplin-notion
PUBLISH := publish

.PHONY: build test lint clean release

build:
	npm run dist

test:
	npm test

lint:
	npm run lint

clean:
	rm -rf $(PUBLISH)

release:
	@set -e; \
	current=$$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"); \
	echo "Current version: $$current"; \
	printf "Bump type? [major/minor/patch] (default: patch): "; \
	read bump; \
	bump=$${bump:-patch}; \
	ver=$${current#v}; \
	major=$$(echo $$ver | cut -d. -f1); \
	minor=$$(echo $$ver | cut -d. -f2); \
	patch=$$(echo $$ver | cut -d. -f3); \
	case $$bump in \
		major) major=$$((major+1)); minor=0; patch=0 ;; \
		minor) minor=$$((minor+1)); patch=0 ;; \
		*)     patch=$$((patch+1)) ;; \
	esac; \
	new="v$${major}.$${minor}.$${patch}"; \
	echo "Tagging and releasing $$new..."; \
	npm version --no-git-tag-version $${new#v}; \
	git add package.json; \
	git commit -m "chore: bump version to $$new"; \
	git tag $$new; \
	git push origin master $$new; \
	$(MAKE) build; \
	gh release create $$new $(PUBLISH)/$(PLUGIN).jpl $(PUBLISH)/$(PLUGIN).json --generate-notes --title "Release $$new"
