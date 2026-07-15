package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/siygle/agentgate/internal/crypto"
)

// Server must be configured via -s flag or AGENTGATE_SERVER env var.

// defaultTTLSeconds mirrors the server's default share lifetime (7 days). Used
// to estimate expires_at for the local registry when no -t is given.
const defaultTTLSeconds = 7 * 24 * 60 * 60

// DiffPayload is the JSON body sent to POST /api/diff.
type DiffPayload struct {
	Title string            `json:"title"`
	Files []DiffPayloadFile `json:"files"`
}

// DiffPayloadFile represents a single file within a diff payload.
type DiffPayloadFile struct {
	Filename string `json:"filename"`
	Language string `json:"language,omitempty"`
	Patch    string `json:"patch"`
}

// FilesPayload is the JSON body sent to POST /api/files.
type FilesPayload struct {
	Files []FilesPayloadFile `json:"files"`
}

// FilesPayloadFile represents a single file within a files payload. Content holds
// UTF-8 text by default; when Encoding is "base64" it holds the base64-encoded raw
// bytes of a binary asset (image, font, media). Encoding is omitted for text so
// older viewers — which treat a missing "encoding" as text — stay compatible.
type FilesPayloadFile struct {
	Title    string `json:"title"`
	Content  string `json:"content"`
	Encoding string `json:"encoding,omitempty"`
}

// PlanPayload is an encrypted visual plan bundle. It is stored through the
// generic file-bundle API so the server still never sees plaintext content.
type PlanPayload struct {
	Kind        string             `json:"kind"`
	Title       string             `json:"title"`
	Entry       string             `json:"entry"`
	Files       []FilesPayloadFile `json:"files"`
	GeneratedAt string             `json:"generated_at"`
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	subcmd := os.Args[1]
	args := os.Args[2:]

	switch subcmd {
	case "git-latest":
		runGitLatest(args)
	case "git-staged":
		runGitStaged(args)
	case "files":
		runFiles(args)
	case "webapp":
		runWebapp(args)
	case "plan":
		runPlan(args)
	case "docs":
		runDocs(args)
	case "list":
		runList(args)
	case "rekey":
		runRekey(args)
	case "key-gen":
		runKeyGen(args)
	case "key-get":
		runKeyGet()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", subcmd)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `Usage: agentgate <command> [options]

Commands:
  git-latest  [-s server] [-p passphrase|-R] [-t ttl|--no-expiry]           Share the latest commit diff
  git-staged  [-s server] [-p passphrase|-R] [-t ttl|--no-expiry]           Share staged changes
  files       [-s server] [-p passphrase|-R] [-t ttl|--no-expiry] <paths...> Share files
  webapp      [-s server] [-p passphrase|-R] [-t ttl|--no-expiry] <dir>      Share a runnable static webapp
  plan        [-s server] [-p passphrase|-R] [-t ttl|--no-expiry] <file|dir> Share an encrypted visual plan
  docs        [-s server] [-p passphrase|-R] [-t ttl|--no-expiry] <file|dir> Share encrypted generic documents
  list        [-m master] [--show-secrets] [--refresh] [-s server]          List shares created on this machine
  rekey       [-s server] [-p newpass] [-m master] <id|url>                  Reset a share's passphrase (re-key in place)
  key-gen     [key]                                                         Generate or set a passphrase
  key-get                                                                   Print current passphrase

TTL examples: 12h, 7d, 30m. Server default is 7d.
Use --no-expiry to keep the share indefinitely (mutually exclusive with -t/--ttl).
Use -R/--random to encrypt this upload with a fresh one-time passphrase (printed
once and saved to your local registry) instead of the shared default key.
The server returns a Manage URL — keep it private; it is required to toggle indefinite retention later.

Shares you create are recorded locally in ~/.agentgate/shares.json. Set -m or
AGENTGATE_MASTER_PASSPHRASE to also store each share's passphrase (encrypted) so
'agentgate list --show-secrets' and 'agentgate rekey' can use it.`)
}

// parseFlags extracts -s, -p, -m, -t, --no-expiry, and -R/--random flags from args, returning
// server, passphrase, master, ttl, noExpiry, and remaining positional args.
func parseFlags(args []string) (server, passphrase, master, ttl string, noExpiry, random bool, rest []string) {
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-s":
			if i+1 < len(args) {
				server = args[i+1]
				i++
			}
		case "-p":
			if i+1 < len(args) {
				passphrase = args[i+1]
				i++
			}
		case "-m", "--master":
			if i+1 < len(args) {
				master = args[i+1]
				i++
			}
		case "-t", "--ttl":
			if i+1 < len(args) {
				ttl = args[i+1]
				i++
			}
		case "--no-expiry":
			noExpiry = true
		case "-R", "--random":
			random = true
		default:
			rest = append(rest, args[i])
		}
	}
	return
}

func resolveServer(flag string) (string, error) {
	if flag != "" {
		return flag, nil
	}
	if env := os.Getenv("AGENTGATE_SERVER"); env != "" {
		return env, nil
	}
	return "", fmt.Errorf("server required: use -s flag or set AGENTGATE_SERVER")
}

func resolvePassphrase(flag string) (string, error) {
	if flag != "" {
		return flag, nil
	}
	if env := os.Getenv("AGENTGATE_PASSPHRASE"); env != "" {
		return env, nil
	}
	return "", fmt.Errorf("passphrase required: use -p flag or set AGENTGATE_PASSPHRASE")
}

// resolvePassphraseForUpload picks the passphrase for a create command. With
// -R/--random it generates a fresh strong one-time passphrase for this upload
// (so shares are not all encrypted under one reused key); otherwise it falls
// back to the -p flag / AGENTGATE_PASSPHRASE env. generated reports whether a
// random one was produced, so the caller can surface it to the user.
func resolvePassphraseForUpload(flag string, random bool) (passphrase string, generated bool, err error) {
	if random {
		if flag != "" {
			return "", false, fmt.Errorf("-R/--random cannot be combined with -p")
		}
		p, gerr := generateRandomPassphrase()
		if gerr != nil {
			return "", false, gerr
		}
		return p, true, nil
	}
	p, rerr := resolvePassphrase(flag)
	return p, false, rerr
}

// generateRandomPassphrase returns a 128-bit URL-safe random passphrase. This is
// far stronger than key-gen's short human key, which is fine here because the
// passphrase is machine-carried (printed once, saved to the registry) rather
// than typed from memory.
func generateRandomPassphrase() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func parseTTLSeconds(input string) (int64, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return 0, fmt.Errorf("empty ttl")
	}
	if strings.HasSuffix(trimmed, "d") {
		days, err := strconv.ParseInt(strings.TrimSuffix(trimmed, "d"), 10, 64)
		if err != nil || days <= 0 {
			return 0, fmt.Errorf("expected positive day duration such as 7d")
		}
		return int64((time.Duration(days) * 24 * time.Hour) / time.Second), nil
	}
	duration, err := time.ParseDuration(trimmed)
	if err != nil || duration <= 0 {
		return 0, fmt.Errorf("expected positive duration such as 12h, 7d, or 30m")
	}
	return int64(duration / time.Second), nil
}

// runGit executes a git command and returns its stdout.
func runGit(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), stderr.String())
	}
	return stdout.String(), nil
}

// splitDiffIntoFiles parses a unified diff into per-file patches.
func splitDiffIntoFiles(diff string) []DiffPayloadFile {
	var files []DiffPayloadFile
	parts := strings.Split(diff, "diff --git ")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		// Re-add the prefix for a complete patch.
		patch := "diff --git " + part
		filename := extractFilename(patch)
		files = append(files, DiffPayloadFile{
			Filename: filename,
			Patch:    patch,
		})
	}
	return files
}

// extractFilename extracts the filename from a +++ b/path line.
func extractFilename(patch string) string {
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, "+++ b/") {
			return strings.TrimPrefix(line, "+++ b/")
		}
	}
	// Fallback: try to get from the diff --git line.
	lines := strings.SplitN(patch, "\n", 2)
	if len(lines) > 0 {
		// diff --git a/foo b/foo
		parts := strings.Fields(lines[0])
		if len(parts) >= 4 {
			return strings.TrimPrefix(parts[len(parts)-1], "b/")
		}
	}
	return "unknown"
}

func encryptAndPost(server, endpoint string, payload any, passphrase, master, ttl string, noExpiry, generated bool) {
	encryptAndPostMode(server, endpoint, payload, passphrase, master, ttl, noExpiry, generated, "")
}

func encryptAndPostMode(server, endpoint string, payload any, passphrase, master, ttl string, noExpiry, generated bool, displayMode string) {
	if noExpiry && ttl != "" {
		fmt.Fprintln(os.Stderr, "error: --no-expiry cannot be combined with -t/--ttl")
		os.Exit(1)
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error marshaling payload: %v\n", err)
		os.Exit(1)
	}

	ciphertext, iv, salt, err := crypto.Encrypt(string(jsonBytes), passphrase)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error encrypting: %v\n", err)
		os.Exit(1)
	}

	body := map[string]any{
		"encrypted_data": map[string]string{
			"ciphertext": ciphertext,
			"iv":         iv,
			"salt":       salt,
		},
	}
	if ttl != "" {
		seconds, err := parseTTLSeconds(ttl)
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid ttl %q: %v\n", ttl, err)
			os.Exit(1)
		}
		body["expires_in_seconds"] = seconds
	}
	if noExpiry {
		body["never_expires"] = true
	}
	bodyBytes, _ := json.Marshal(body)

	url := strings.TrimRight(server, "/") + endpoint
	resp, err := http.Post(url, "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error posting to %s: %v\n", url, err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	result := printCreateResponse(respBody, server, displayMode)
	if result != nil {
		if generated {
			fmt.Printf("Passphrase:  %s\n", passphrase)
			fmt.Println("(random one-time key — give it to viewers out-of-band; also saved to your local registry)")
		}
		recordShare(result, payload, endpoint, displayMode, server, passphrase, master, ttl, noExpiry)
	}
}

// recordShare appends the just-created share to the local owner registry
// (~/.agentgate/shares.json). Best-effort: registry problems warn but never
// fail the create. The passphrase is stored only when a master passphrase is
// available (flag/env), encrypted under it.
func recordShare(result *createResult, payload any, endpoint, displayMode, server, passphrase, masterFlag, ttl string, noExpiry bool) {
	kind := "files"
	if strings.Contains(endpoint, "/api/diff") {
		kind = "diff"
	}
	display := displayMode
	if display == "" {
		display = kind
	}

	title := ""
	switch p := payload.(type) {
	case DiffPayload:
		title = p.Title
	case PlanPayload:
		title = p.Title
	}

	var expiresAt string
	if !noExpiry {
		seconds := int64(defaultTTLSeconds)
		if ttl != "" {
			if s, err := parseTTLSeconds(ttl); err == nil {
				seconds = s
			}
		}
		expiresAt = time.Now().Add(time.Duration(seconds) * time.Second).UTC().Format(time.RFC3339)
	}

	rec := shareRecord{
		ID:           result.ID,
		Kind:         kind,
		Display:      display,
		Title:        title,
		Server:       server,
		PreviewURL:   result.PreviewURL,
		ManageURL:    result.ManageURL,
		OwnerToken:   result.OwnerToken,
		NeverExpires: noExpiry,
		ExpiresAt:    expiresAt,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	master, _ := resolveMaster(masterFlag, false)
	if master != "" {
		if blob, err := encryptPassphrase(passphrase, master); err == nil {
			rec.PassphraseEnc = blob
		} else {
			fmt.Fprintf(os.Stderr, "warning: could not encrypt passphrase for registry: %v\n", err)
		}
	}

	recsBefore, _ := loadRegistry()
	if err := upsertRecord(rec); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not update local registry: %v\n", err)
		return
	}
	if master == "" && len(recsBefore) == 0 {
		fmt.Fprintln(os.Stderr, "hint: set AGENTGATE_MASTER_PASSPHRASE (or -m) to also save each share's passphrase to your local registry — see `agentgate list`.")
	}
}

// rebaseURL rewrites the scheme/host of rawURL to match the server the request
// was sent to, but only when the server reports a loopback host. This keeps
// printed links usable when the server's --base-url is left at its localhost
// default while still being reached over a public address.
func rebaseURL(rawURL, server string) string {
	if rawURL == "" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	host := u.Hostname()
	if host != "localhost" && host != "127.0.0.1" && host != "::1" {
		return rawURL
	}
	s, err := url.Parse(server)
	if err != nil || s.Host == "" {
		return rawURL
	}
	u.Scheme = s.Scheme
	u.Host = s.Host
	return u.String()
}

// createResult holds the display-adjusted URLs and identifiers parsed from a
// successful create response, for recording into the local registry.
type createResult struct {
	PreviewURL string
	ManageURL  string
	ID         string
	OwnerToken string
}

// printCreateResponse decodes the server response and, when successful, prints a
// friendly summary including the manage URL and returns the parsed result.
// Falls back to raw output on parse failure (returns nil) so debugging stays
// possible; exits on a server error.
func printCreateResponse(body []byte, server string, displayMode string) *createResult {
	var parsed struct {
		Success bool `json:"success"`
		Data    struct {
			PreviewURL string `json:"preview_url"`
			ManageURL  string `json:"manage_url"`
			ID         string `json:"id"`
			OwnerToken string `json:"owner_token"`
		} `json:"data"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || (!parsed.Success && parsed.Error == "" && parsed.Data.PreviewURL == "") {
		fmt.Println(string(body))
		return nil
	}
	if !parsed.Success {
		fmt.Fprintf(os.Stderr, "server error: %s\n", parsed.Error)
		os.Exit(1)
	}
	previewURL := rebaseURL(parsed.Data.PreviewURL, server)
	manageURL := rebaseURL(parsed.Data.ManageURL, server)
	label := "Preview URL"
	switch displayMode {
	case "app":
		label = "App URL"
		previewURL = strings.Replace(previewURL, "/f/", "/app/", 1)
		manageURL = strings.Replace(manageURL, "/f/", "/app/", 1)
	case "plan":
		label = "Plan URL"
		previewURL = strings.Replace(previewURL, "/f/", "/plan/", 1)
		manageURL = strings.Replace(manageURL, "/f/", "/plan/", 1)
	case "docs":
		label = "Docs URL"
		previewURL = strings.Replace(previewURL, "/f/", "/d/", 1)
		manageURL = strings.Replace(manageURL, "/f/", "/d/", 1)
	}
	fmt.Printf("%-12s %s\n", label+":", previewURL)
	if manageURL != "" {
		fmt.Printf("Manage URL:  %s\n", manageURL)
		fmt.Println("(Keep the Manage URL private — it lets you toggle indefinite retention on this share.)")
	}
	return &createResult{
		PreviewURL: previewURL,
		ManageURL:  manageURL,
		ID:         parsed.Data.ID,
		OwnerToken: parsed.Data.OwnerToken,
	}
}

func runGitLatest(args []string) {
	serverFlag, passFlag, masterFlag, ttlFlag, noExpiry, randomFlag, _ := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, generated, err := resolvePassphraseForUpload(passFlag, randomFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	diff, err := runGit("diff", "HEAD~1")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	subject, err := runGit("log", "-1", "--format=%s")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	files := splitDiffIntoFiles(diff)
	payload := DiffPayload{
		Title: strings.TrimSpace(subject),
		Files: files,
	}

	encryptAndPost(server, "/api/diff", payload, passphrase, masterFlag, ttlFlag, noExpiry, generated)
}

func runGitStaged(args []string) {
	serverFlag, passFlag, masterFlag, ttlFlag, noExpiry, randomFlag, _ := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, generated, err := resolvePassphraseForUpload(passFlag, randomFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	diff, err := runGit("diff", "--cached")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	files := splitDiffIntoFiles(diff)
	payload := DiffPayload{
		Title: "Staged changes",
		Files: files,
	}

	encryptAndPost(server, "/api/diff", payload, passphrase, masterFlag, ttlFlag, noExpiry, generated)
}

func runFiles(args []string) {
	serverFlag, passFlag, masterFlag, ttlFlag, noExpiry, randomFlag, paths := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, generated, err := resolvePassphraseForUpload(passFlag, randomFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if len(paths) == 0 {
		fmt.Fprintln(os.Stderr, "error: no file paths provided")
		os.Exit(1)
	}

	var files []FilesPayloadFile
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error reading %s: %v\n", p, err)
			os.Exit(1)
		}
		files = append(files, FilesPayloadFile{
			Title:   filepath.Base(p),
			Content: string(data),
		})
	}

	payload := FilesPayload{Files: files}
	encryptAndPost(server, "/api/files", payload, passphrase, masterFlag, ttlFlag, noExpiry, generated)
}

// binaryExt lists extensions whose raw bytes do not survive being stored as a
// UTF-8 string. Files with these extensions are base64-encoded into the bundle
// (Encoding:"base64") so images, fonts, and media render in the viewer.
var binaryExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".ico": true, ".bmp": true, ".woff": true, ".woff2": true, ".ttf": true,
	".otf": true, ".eot": true, ".mp3": true, ".mp4": true, ".webm": true,
	".wav": true, ".pdf": true, ".zip": true, ".wasm": true,
}

// bundleBudgetBytes is a conservative client-side soft cap on total raw asset
// bytes in a bundle. Exceeding it only warns — the server enforces the real,
// backend-specific limit and returns 413. ~1 MB of raw bytes keeps the encrypted
// bundle under Cloudflare D1's 2 MB per-value hard cap in the default D1-only
// mode; R2 (Worker) or a filesystem blob dir (self-host) lift that ceiling.
const bundleBudgetBytes = 1 << 20

// readBundleFile reads one file for a webapp/docs bundle. Binary assets (by
// extension) are base64-encoded so their bytes survive JSON + encryption; text
// files stay as UTF-8 and carry no encoding marker. It also returns the raw byte
// count so callers can track the bundle budget.
func readBundleFile(path, rel string) (FilesPayloadFile, int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return FilesPayloadFile{}, 0, err
	}
	if binaryExt[strings.ToLower(filepath.Ext(path))] {
		return FilesPayloadFile{
			Title:    rel,
			Content:  base64.StdEncoding.EncodeToString(data),
			Encoding: "base64",
		}, len(data), nil
	}
	return FilesPayloadFile{Title: rel, Content: string(data)}, len(data), nil
}

// warnIfOverBudget prints a soft warning (never fails) when a bundle's total raw
// bytes exceed the client-side budget, pointing at the storage escape hatches.
func warnIfOverBudget(totalBytes int) {
	if totalBytes <= bundleBudgetBytes {
		return
	}
	fmt.Fprintf(os.Stderr,
		"warning: bundle is %d KB of raw assets, over the ~%d KB soft budget. "+
			"The server may reject it (413) in D1-only mode; enable R2 (Worker) or set "+
			"AGENTGATE_BLOB_DIR (self-host) to store larger bundles.\n",
		totalBytes/1024, bundleBudgetBytes/1024)
}

func runWebapp(args []string) {
	serverFlag, passFlag, masterFlag, ttlFlag, noExpiry, randomFlag, paths := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, generated, err := resolvePassphraseForUpload(passFlag, randomFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if len(paths) != 1 {
		fmt.Fprintln(os.Stderr, "error: webapp takes exactly one directory")
		os.Exit(1)
	}
	root := paths[0]
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		fmt.Fprintf(os.Stderr, "error: %q is not a directory\n", root)
		os.Exit(1)
	}

	var files []FilesPayloadFile
	hasIndex := false
	totalBytes := 0
	err = filepath.Walk(root, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		base := filepath.Base(p)
		if fi.IsDir() {
			if p != root && strings.HasPrefix(base, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(base, ".") {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		file, n, err := readBundleFile(p, rel)
		if err != nil {
			return err
		}
		if rel == "index.html" {
			hasIndex = true
		}
		totalBytes += n
		files = append(files, file)
		return nil
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading %s: %v\n", root, err)
		os.Exit(1)
	}
	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "error: no usable files found")
		os.Exit(1)
	}
	if !hasIndex {
		fmt.Fprintln(os.Stderr, "error: no index.html at the root of the directory")
		os.Exit(1)
	}
	warnIfOverBudget(totalBytes)

	payload := FilesPayload{Files: files}
	encryptAndPostMode(server, "/api/files", payload, passphrase, masterFlag, ttlFlag, noExpiry, generated, "app")
}

func runPlan(args []string) {
	runDocumentBundle(args, "visual-plan", "plan")
}

func runDocs(args []string) {
	runDocumentBundle(args, "documents", "docs")
}

func runDocumentBundle(args []string, kind, displayMode string) {
	serverFlag, passFlag, masterFlag, ttlFlag, noExpiry, randomFlag, paths := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, generated, err := resolvePassphraseForUpload(passFlag, randomFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if len(paths) != 1 {
		fmt.Fprintf(os.Stderr, "error: %s takes exactly one file or directory\n", displayMode)
		os.Exit(1)
	}

	root := paths[0]
	info, err := os.Stat(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading %s: %v\n", root, err)
		os.Exit(1)
	}

	var files []FilesPayloadFile
	entry := ""
	totalBytes := 0
	if info.IsDir() {
		err = filepath.Walk(root, func(p string, fi os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			base := filepath.Base(p)
			if fi.IsDir() {
				if p != root && strings.HasPrefix(base, ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasPrefix(base, ".") {
				return nil
			}
			rel, err := filepath.Rel(root, p)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			file, n, err := readBundleFile(p, rel)
			if err != nil {
				return err
			}
			lowerRel := strings.ToLower(rel)
			if lowerRel == "plan.mdx" || lowerRel == "plan.md" || lowerRel == "readme.mdx" || lowerRel == "readme.md" {
				entry = rel
			} else if entry == "" && (strings.HasSuffix(lowerRel, ".mdx") || strings.HasSuffix(lowerRel, ".md")) {
				entry = rel
			}
			totalBytes += n
			files = append(files, file)
			return nil
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "error reading %s: %v\n", root, err)
			os.Exit(1)
		}
	} else {
		file, n, err := readBundleFile(root, filepath.Base(root))
		if err != nil {
			fmt.Fprintf(os.Stderr, "error reading %s: %v\n", root, err)
			os.Exit(1)
		}
		entry = filepath.Base(root)
		totalBytes += n
		files = append(files, file)
	}

	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "error: no usable plan files found")
		os.Exit(1)
	}
	warnIfOverBudget(totalBytes)
	if entry == "" {
		entry = files[0].Title
	}

	payload := PlanPayload{
		Kind:        kind,
		Title:       strings.TrimSuffix(filepath.Base(entry), filepath.Ext(entry)),
		Entry:       entry,
		Files:       files,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}
	encryptAndPostMode(server, "/api/files", payload, passphrase, masterFlag, ttlFlag, noExpiry, generated, displayMode)
}

func runKeyGen(args []string) {
	var key string
	if len(args) > 0 {
		key = args[0]
	} else {
		key = generateKey(8)
	}

	rcFile := shellRCFile()
	line := fmt.Sprintf("export AGENTGATE_PASSPHRASE=\"%s\"", key)

	// Append to rc file.
	f, err := os.OpenFile(rcFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error opening %s: %v\n", rcFile, err)
		os.Exit(1)
	}
	defer f.Close()

	if _, err := fmt.Fprintf(f, "\n%s\n", line); err != nil {
		fmt.Fprintf(os.Stderr, "error writing to %s: %v\n", rcFile, err)
		os.Exit(1)
	}

	fmt.Printf("Passphrase: %s\n", key)
	fmt.Printf("Written to: %s\n", rcFile)
	fmt.Println("Run `source " + rcFile + "` or open a new shell to activate.")
}

func runKeyGet() {
	key := os.Getenv("AGENTGATE_PASSPHRASE")
	if key == "" {
		fmt.Fprintln(os.Stderr, "AGENTGATE_PASSPHRASE is not set")
		os.Exit(1)
	}
	fmt.Println(key)
}

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

func generateKey(length int) string {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		fmt.Fprintf(os.Stderr, "error generating key: %v\n", err)
		os.Exit(1)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func shellRCFile() string {
	home, _ := os.UserHomeDir()
	shell := os.Getenv("SHELL")
	switch {
	case strings.Contains(shell, "zsh"):
		return filepath.Join(home, ".zshrc")
	case strings.Contains(shell, "bash"):
		return filepath.Join(home, ".bashrc")
	default:
		return filepath.Join(home, ".profile")
	}
}
