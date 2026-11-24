package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildArtifactPayloadSingleFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Dashboard.tsx")
	if err := os.WriteFile(path, []byte("export default function App() { return <div>Hi</div>; }"), 0o644); err != nil {
		t.Fatal(err)
	}

	payload, totalBytes, err := buildArtifactPayload(path)
	if err != nil {
		t.Fatalf("buildArtifactPayload failed: %v", err)
	}
	if payload.Kind != "artifact" {
		t.Fatalf("expected kind=artifact, got %q", payload.Kind)
	}
	if payload.Entry != "Dashboard.tsx" {
		t.Fatalf("expected entry=Dashboard.tsx, got %q", payload.Entry)
	}
	if payload.Title != "Dashboard" {
		t.Fatalf("expected title=Dashboard, got %q", payload.Title)
	}
	if len(payload.Files) != 1 || totalBytes == 0 {
		t.Fatalf("unexpected files=%d totalBytes=%d", len(payload.Files), totalBytes)
	}
}

func TestBuildArtifactPayloadDirectorySkipsDotAndNodeModules(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "my-chart")
	if err := os.MkdirAll(filepath.Join(dir, "components"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}

	writes := map[string]string{
		"App.tsx":                   "import Chart from './components/Chart'; export default Chart;",
		"components/Chart.tsx":      "export default function Chart() { return null; }",
		"styles.css":                "body { margin: 0; }",
		".env":                      "SECRET=1",
		".git/HEAD":                 "ref: refs/heads/main",
		"node_modules/pkg/index.js": "module.exports = {};",
	}
	for rel, content := range writes {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	payload, _, err := buildArtifactPayload(dir)
	if err != nil {
		t.Fatalf("buildArtifactPayload failed: %v", err)
	}
	if payload.Kind != "artifact" {
		t.Fatalf("expected kind=artifact, got %q", payload.Kind)
	}
	if payload.Entry != "App.tsx" {
		t.Fatalf("expected entry=App.tsx, got %q", payload.Entry)
	}
	if payload.Title != "my-chart" {
		t.Fatalf("expected title=my-chart, got %q", payload.Title)
	}
	if len(payload.Files) != 3 {
		t.Fatalf("expected 3 non-ignored files, got %d: %+v", len(payload.Files), payload.Files)
	}
}

func TestPickArtifactEntryPriority(t *testing.T) {
	files := []FilesPayloadFile{
		{Title: "styles.css"},
		{Title: "helper.ts"},
		{Title: "index.jsx"},
		{Title: "App.tsx"},
	}
	if got := pickArtifactEntry(files); got != "App.tsx" {
		t.Fatalf("expected App.tsx, got %q", got)
	}

	svgOnly := []FilesPayloadFile{{Title: "diagram.svg"}}
	if got := pickArtifactEntry(svgOnly); got != "diagram.svg" {
		t.Fatalf("expected diagram.svg, got %q", got)
	}
}
