.PHONY: all clean deps compile package install uninstall

VSIX = scimax-vscode-0.1.0.vsix
CODE = /Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code

all: package

deps:
	npm install

compile: deps
	npm run compile

package: compile
	npm run package

install: package
	$(CODE) --install-extension $(VSIX)

uninstall:
	$(CODE) --uninstall-extension scimax-vscode

clean:
	rm -rf out node_modules *.vsix
