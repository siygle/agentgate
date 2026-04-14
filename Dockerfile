FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /diffmini-server ./cmd/server
RUN CGO_ENABLED=0 go build -o /diffmini-cli ./cmd/cli

FROM alpine:3.20

RUN apk add --no-cache ca-certificates
COPY --from=build /diffmini-server /usr/local/bin/diffmini-server
COPY --from=build /diffmini-cli /usr/local/bin/diffmini

VOLUME /data
EXPOSE 8080

CMD ["diffmini-server", "--db", "/data/diffmini.db"]
