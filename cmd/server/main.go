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
	"syscall"
	"time"

	"github.com/siygle/agentgate/internal/cleanup"
	"github.com/siygle/agentgate/internal/db"
	"github.com/siygle/agentgate/internal/server"
	"github.com/siygle/agentgate/web"
)

func main() {
	port := flag.Int("port", envOrDefaultInt("PORT", 8080), "HTTP port")
	dbPath := flag.String("db", envOrDefault("DATABASE_PATH", "./agentgate.db"), "SQLite database path")
	baseURL := flag.String("base-url", envOrDefault("BASE_URL", "http://localhost:8080"), "Public base URL")
	flag.Parse()

	// Open database.
	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	// Prepare embedded filesystems.
	templateFS, err := fs.Sub(web.TemplateFS, "templates")
	if err != nil {
		log.Fatalf("failed to create template sub-FS: %v", err)
	}
	staticFS, err := fs.Sub(web.StaticFS, "static")
	if err != nil {
		log.Fatalf("failed to create static sub-FS: %v", err)
	}

	// Create server.
	srv := server.New(database, *baseURL, templateFS, staticFS)

	// Start cleanup goroutine.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cleanup.Start(ctx, database, 1*time.Hour)

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
