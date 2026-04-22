# Refactoring Notes: TypeScript to Golang 

## Overview
We migrated KendaliAI from a massive Bun/TypeScript monolith built heavily around Node, React, and modular structures, into a hyper-fast, highly-focused Golang application designed to perform directly as an autonomous OS AI agent.

## Key Architectural Shifts

### 1. The Cognition Loop replacing "Routers"
We dropped hard-coded prompt parsing and introduced the `agent.CognitionLoop` inside `internal/agent/cognition.go`. It parses LLM responses iteratively (up to 25 loops). 
When the LLM detects a string format like: `tool: read_file({"filename": "main.go", "start_line": 1, "end_line": 50})`, the Golang loop executes the filesystem logic natively intercepting it, and appends the OS output to the thread via `tool_result(output)`.

### 2. Elimination of Web Dashboard for Native TUI
The React/Vite dashboard was stripped out to favor Terminal-first execution. 
Using `charmbracelet/bubbletea`, `lipgloss`, and `bubbles`, we built an asynchronous natively compiled CLI dashboard. The TUI embeds the exact same `CognitionLoop` execution flow implicitly, meaning you get identical AI intelligence running headlessly in your terminal without needing an underlying HTTP REST Server.

### 3. Dynamic Registry Injections
The `Persona.md` script was overhauled to act natively as the AI's identity boundary. Tools are no longer hardcoded in logic arrays. Instead, they are parsed purely off `tools: read_file, bash` configuration schemas during runtime, dynamically injecting execution privileges into the LLM system prompts block. 

### 4. Stream Pub/Sub Logistics
Isolated terminal streams were unified. `internal/logger/syslog.go` binds OS outputs. Both the asynchronous Gateway Telegram process and the isolated TUI component process append telemetry straight into `~/.kendaliai/system.log`. 
A new specific CLI command `go run ./cmd/kendaliai logs` executes a natively-bound concurrent tail across this dataset giving total platform observability visually.

## Known Deprecations & Cleanups
- Dropped all raw JS/Node dependencies completely (`package.json`, `node_modules`, `src/`).
- Moved `go_version` namespace binaries straight into root.
- Upgraded the prompt engine to explicitly penalize endless directory scans recursively (`Harness & Evaluator Guidelines`).
- Set `DEEPSEEK_API_KEY` to act as the global primary provider inside `internal/providers`, dropping ZAI down to fallback usage dynamically.
