package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/siygle/agentgate/internal/crypto"
)

// Server must be configured via -s flag or AGENTGATE_SERVER env var.

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

// FilesPayloadFile represents a single file within a files payload.
type FilesPayloadFile struct {
	Title   string `json:"title"`
	Content string `json:"content"`
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
  git-latest  [-s server] [-p passphrase]   Share the latest commit diff
  git-staged  [-s server] [-p passphrase]   Share staged changes
  files       [-s server] [-p passphrase] <paths...>  Share files
  key-gen     [key]                          Generate or set a passphrase
  key-get                                    Print current passphrase`)
}

// parseFlags extracts -s and -p flags from args, returning server, passphrase,
// and remaining positional args.
func parseFlags(args []string) (server, passphrase string, rest []string) {
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

func encryptAndPost(server, endpoint string, payload any, passphrase string) {
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
	bodyBytes, _ := json.Marshal(body)

	url := strings.TrimRight(server, "/") + endpoint
	resp, err := http.Post(url, "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error posting to %s: %v\n", url, err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	fmt.Println(string(respBody))
}

func runGitLatest(args []string) {
	serverFlag, passFlag, _ := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, err := resolvePassphrase(passFlag)
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

	encryptAndPost(server, "/api/diff", payload, passphrase)
}

func runGitStaged(args []string) {
	serverFlag, passFlag, _ := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, err := resolvePassphrase(passFlag)
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

	encryptAndPost(server, "/api/diff", payload, passphrase)
}

func runFiles(args []string) {
	serverFlag, passFlag, paths := parseFlags(args)
	server, err := resolveServer(serverFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	passphrase, err := resolvePassphrase(passFlag)
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
	encryptAndPost(server, "/api/files", payload, passphrase)
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
