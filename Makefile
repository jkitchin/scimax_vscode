.PHONY: all clean deps compile package install uninstall publish

VSIX = scimax-vscode-0.3.1.vsix
CODE = /Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code

all: package

deps:
	npm install

compile: deps
	npm run compile
	@# Copy theme assets to output directory
	mkdir -p out/publishing/themes/bookTheme/assets
	cp -r src/publishing/themes/bookTheme/assets/* out/publishing/themes/bookTheme/assets/

package: compile
	npm run package

install: package
	$(CODE) --install-extension $(VSIX)

uninstall:
	$(CODE) --uninstall-extension scimax-vscode

install-latest:
	@echo "Downloading latest release from GitHub..."
	@rm -f scimax-vscode-*.vsix
	gh release download --pattern "*.vsix" --repo jkitchin/scimax_vscode
	@echo "Installing..."
	$(CODE) --install-extension scimax-vscode-*.vsix --force
	@echo "Done. Reload VS Code to activate."

publish: package
	vsce publish

clean:
	rm -rf out node_modules *.vsix
