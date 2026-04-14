.PHONY: build server cli clean dev docker

# Default target
build: server cli

server:
	go build -o bin/diffmini-server ./cmd/server

cli:
	go build -o bin/diffmini ./cmd/cli

dev: server
	./bin/diffmini-server --port 8080 --base-url http://localhost:8080

clean:
	rm -rf bin/

docker:
	docker build -t diffmini .

# Cross-compilation targets
.PHONY: release
release:
	GOOS=darwin GOARCH=arm64 go build -o bin/diffmini-server-darwin-arm64 ./cmd/server
	GOOS=darwin GOARCH=amd64 go build -o bin/diffmini-server-darwin-amd64 ./cmd/server
	GOOS=linux GOARCH=amd64 go build -o bin/diffmini-server-linux-amd64 ./cmd/server
	GOOS=linux GOARCH=arm64 go build -o bin/diffmini-server-linux-arm64 ./cmd/server
	GOOS=darwin GOARCH=arm64 go build -o bin/diffmini-darwin-arm64 ./cmd/cli
	GOOS=darwin GOARCH=amd64 go build -o bin/diffmini-darwin-amd64 ./cmd/cli
	GOOS=linux GOARCH=amd64 go build -o bin/diffmini-linux-amd64 ./cmd/cli
	GOOS=linux GOARCH=arm64 go build -o bin/diffmini-linux-arm64 ./cmd/cli
