.PHONY: build server cli clean dev docker test

# Default target
build: server cli

test:
	go test -race ./...
	node web/static/js/sandbox.node.test.mjs
	node web/static/js/share-kind.node.test.mjs
	node web/static/js/passphrase.node.test.mjs
	node web/static/js/crypto.node.test.mjs
	node web/static/js/i18n.node.test.mjs
	node web/static/renderers/common/frame-ui.node.test.mjs
	node web/static/renderers/artifact/renderer.node.test.mjs
	node web/static/renderers/doc/markdown.node.test.mjs
	go run ./cmd/crossvector > /tmp/agentgate-crossvector.json && node web/static/js/crypto.crossvector.test.mjs /tmp/agentgate-crossvector.json && rm -f /tmp/agentgate-crossvector.json
	cd worker && npm run typecheck && npm test

server:
	go build -o bin/agentgate-server ./cmd/server

cli:
	go build -o bin/agentgate ./cmd/agentgate

dev: server
	./bin/agentgate-server --port 8080 --base-url http://localhost:8080

clean:
	rm -rf bin/

docker:
	docker build -t agentgate .

# Cross-compilation targets
.PHONY: release
release:
	GOOS=darwin GOARCH=arm64 go build -o bin/agentgate-server-darwin-arm64 ./cmd/server
	GOOS=darwin GOARCH=amd64 go build -o bin/agentgate-server-darwin-amd64 ./cmd/server
	GOOS=linux GOARCH=amd64 go build -o bin/agentgate-server-linux-amd64 ./cmd/server
	GOOS=linux GOARCH=arm64 go build -o bin/agentgate-server-linux-arm64 ./cmd/server
	GOOS=darwin GOARCH=arm64 go build -o bin/agentgate-darwin-arm64 ./cmd/agentgate
	GOOS=darwin GOARCH=amd64 go build -o bin/agentgate-darwin-amd64 ./cmd/agentgate
	GOOS=linux GOARCH=amd64 go build -o bin/agentgate-linux-amd64 ./cmd/agentgate
	GOOS=linux GOARCH=arm64 go build -o bin/agentgate-linux-arm64 ./cmd/agentgate
