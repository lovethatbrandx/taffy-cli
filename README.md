# taffy-cli

Natural language to action on the command line. Powered by Ollama (or any OpenAI-compatible LLM).

```
taffy "bump some tunes"        → launches mpv/spotify/vlc
taffy "edit my bashrc"         → vim ~/.bashrc
taffy "find large files"       → find ~ -type f -size +100M
taffy "surf the net"           → launches chromium/firefox
taffy "list docker containers" → docker ps
```

Taffy knows what's installed on your system. GUI apps, CLI tools, snap packages, flatpak — she scans it all and uses that inventory to pick the right tool for the job.

## Install

```bash
git clone https://github.com/REPO/taffy-cli.git
cd taffy-cli
bun install
bun run build
chmod +x dist/taffy-cli
mv dist/taffy-cli /usr/local/bin/taffy-cli
```

## Configure

Taffy defaults to Ollama on `localhost:11434`. Just have Ollama running with a model pulled:

```bash
ollama pull llama3
```

Config lives at `~/.config/taffy/config.json` (auto-created on first run):

```json
{
  "type": "Custom",
  "model": "llama3",
  "baseURL": "http://localhost:11434/v1",
  "apiKey": "ollama"
}
```

### Other providers

```json
{ "type": "OpenAI", "apiKey": "sk-...", "model": "gpt-4.1" }
{ "type": "Claude", "apiKey": "sk-ant-...", "model": "claude-3-opus-20240229" }
{ "type": "Gemini", "apiKey": "...", "model": "gemini-pro" }
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `TAFFY_API_KEY` | API key (overrides config) |
| `TAFFY_MODEL` | Model name |
| `TAFFY_BASE_URL` | API endpoint |
| `TAFFY_PROVIDER_TYPE` | Provider: OpenAI, Custom, Claude, Gemini, GitHub |
| `TAFFY_CLIPBOARD` | Copy commands to clipboard (true/false) |

## Shell integration

Add the `taffy` function to your shell so commands get loaded into your prompt for editing:

```bash
# bash
echo 'source /path/to/taffy-cli/scripts/taffy.sh' >> ~/.bashrc

# zsh
echo 'source /path/to/taffy-cli/scripts/taffy.sh' >> ~/.zshrc
```

Then use `taffy` instead of `taffy-cli`:

```bash
taffy "find all .log files over 50MB"
# → command appears in your prompt, editable before execution
```

## Flags

| Flag | Description |
|------|-------------|
| `--rescan` | Force fresh app scan (ignore cache) |
| `--no-scan` | Skip app scanning entirely |
| `--soul <path>` | Load personality from a custom SOUL.md |
| `-h, --help` | Show help |

## SOUL.md

Taffy loads a personality from SOUL.md. Drop your own at `~/.config/taffy/SOUL.md` to customize how she talks, what she knows, and how she acts.

The default SOUL.md ships with the repo — warm, slightly sassy, efficient. Replace it with whatever you want.

## App scanning

Taffy scans your system for installed applications:

- **XDG** — `/usr/share/applications/*.desktop` and `~/.local/share/applications/`
- **Snap** — `/snap/bin/`
- **Flatpak** — `/var/lib/flatpak/exports/bin/`
- **PATH** — all binaries in your `$PATH`

Results are cached at `~/.config/taffy/registry.json` (1 hour TTL). Use `--rescan` to force a refresh after installing new apps.

## How it works

1. You type `taffy "some natural language request"`
2. Taffy loads your app inventory, shell history, and SOUL.md personality
3. Everything gets composed into a system prompt
4. The LLM responds with a structured JSON action:
   - `{"type": "command", "command": "..."}` — shell command
   - `{"type": "launch", "app": "..."}` — launch a detected app
   - `{"type": "composite", "steps": [...]}` — multi-step action
5. Taffy prints the result (or loads it into your shell prompt for editing)

## License

MIT
