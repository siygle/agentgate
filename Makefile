.PHONY: build server cli clean dev docker

# Default target
build: server cli

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
