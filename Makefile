.PHONY: all clean deps compile package install uninstall

VSIX = scimax-vscode-0.2.0.vsix
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

clean:
	rm -rf out node_modules *.vsix
