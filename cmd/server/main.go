package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/siygle/agentgate/internal/blobstore"
	"github.com/siygle/agentgate/internal/cleanup"
	"github.com/siygle/agentgate/internal/db"
	"github.com/siygle/agentgate/internal/server"
	"github.com/siygle/agentgate/web"
)

func main() {
	port := flag.Int("port", envOrDefaultInt("PORT", 8080), "HTTP port")
	dbPath := flag.String("db", envOrDefault("DATABASE_PATH", "./agentgate.db"), "SQLite database path")
	baseURL := flag.String("base-url", envOrDefault("BASE_URL", "http://localhost:8080"), "Public base URL")
	blobDir := flag.String("blob-dir", envOrDefault("AGENTGATE_BLOB_DIR", ""), "Directory for external encrypted blob storage (empty = store blobs inline in the DB)")
	flag.Parse()

	// Open database.
	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	// Optional filesystem blob store (empty dir = inline storage).
	blobs, err := blobstore.New(*blobDir)
	if err != nil {
		log.Fatalf("failed to init blob store: %v", err)
	}
	if blobs.Enabled() {
		log.Printf("blob storage: filesystem (%s)", *blobDir)
	}

	// Prepare embedded filesystem.
	staticFS, err := fs.Sub(web.StaticFS, "static")
	if err != nil {
		log.Fatalf("failed to create static sub-FS: %v", err)
	}

	// Owner dashboard config. An empty AGENTGATE_SESSION_SECRET disables the
	// admin subsystem entirely (fail closed).
	adminCfg := server.AdminConfig{
		SessionSecret: os.Getenv("AGENTGATE_SESSION_SECRET"),
		SessionTTL:    time.Duration(envOrDefaultInt("AGENTGATE_SESSION_TTL", 0)) * time.Second,
		OwnerKey:      os.Getenv("AGENTGATE_OWNER_KEY"),
		SecureCookies: strings.HasPrefix(*baseURL, "https://"),
		CFAccess: server.CFAccessConfig{
			Enabled:    os.Getenv("AGENTGATE_CF_ACCESS_ENABLED") == "true",
			TeamDomain: os.Getenv("AGENTGATE_CF_ACCESS_TEAM_DOMAIN"),
			AUD:        os.Getenv("AGENTGATE_CF_ACCESS_AUD"),
			Emails:     splitCSV(os.Getenv("AGENTGATE_CF_ACCESS_EMAILS")),
		},
	}
	if adminCfg.SessionSecret == "" {
		log.Printf("admin dashboard: disabled (set AGENTGATE_SESSION_SECRET to enable)")
	} else {
		log.Printf("admin dashboard: enabled at /admin")
	}

	// Create server.
	srv := server.New(database, *baseURL, staticFS, blobs, adminCfg)

	// Start cleanup goroutine.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cleanup.Start(ctx, database, blobs, 1*time.Hour)

	// Start HTTP server.
	addr := fmt.Sprintf(":%d", *port)
	httpServer := &http.Server{
		Addr:    addr,
		Handler: srv,
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Printf("received signal %v, shutting down...", sig)
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTP server shutdown error: %v", err)
		}
	}()

	log.Printf("starting server on %s (base URL: %s)", addr, *baseURL)
	if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("HTTP server error: %v", err)
	}
	log.Println("server stopped")
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// splitCSV parses a comma-separated env var into trimmed, non-empty entries.
func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func envOrDefaultInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return fallback
	}
	return n
}
