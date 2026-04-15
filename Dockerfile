FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /agentgate-server ./cmd/server
RUN CGO_ENABLED=0 go build -o /agentgate-cli ./cmd/agentgate

FROM alpine:3.20

RUN apk add --no-cache ca-certificates
COPY --from=build /agentgate-server /usr/local/bin/agentgate-server
COPY --from=build /agentgate-cli /usr/local/bin/agentgate

VOLUME /data
EXPOSE 8080

CMD ["agentgate-server", "--db", "/data/agentgate.db"]
