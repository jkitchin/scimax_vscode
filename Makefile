.PHONY: all clean install compile package

all: package

install:
	npm install

compile: install
	npm run compile

package: compile
	npm run package

clean:
	rm -rf out node_modules *.vsix
