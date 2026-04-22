package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/kendaliai/app/internal/logger"
)

type Provider interface {
	ChatCompletion(ctx context.Context, msgs []Message) (*Response, error)
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Response struct {
	Content string `json:"content"`
}

type CognitionLoop struct {
	Provider Provider
	MaxSteps int
	OnTool   func(toolName string, args map[string]interface{})
}

func NewCognitionLoop(p Provider, maxSteps int) *CognitionLoop {
	return &CognitionLoop{
		Provider: p,
		MaxSteps: maxSteps,
	}
}

const baseSystemPrompt = `You are a coding assistant whose goal it is to help us solve coding tasks. 
You have access to a series of tools you can execute. Here are the tools you can execute:

{tool_list_repr}

When you want to use a tool, reply with exactly one line in the format: 'tool: TOOL_NAME({"arg": "value"})' and nothing else.
Use compact single-line JSON with double quotes. After receiving a tool_result(...) message, continue the task.
If no tool is needed, OR if you have completely answered the user's request, simply respond normally with your final answer and DO NOT output any tool prefixes.

HARNESS & EVALUATION GUIDELINES:
1. When asked to evaluate or summarize a codebase, NEVER read every file blindly.
2. First use 'list_files' to navigate the directory structure.
3. Identify and use 'read_file' EXCLUSIVELY on core architectural entry points (e.g., main.go, package.json, go.mod, schema.go) to understand the application logic.
4. Stop calling tools after reading 2 to 3 main files. Give a detailed response based ONLY on those core files and do not deep-dive into internal utility files.

IDENTITY & CONFIG:
{persona_text}
`

type ToolDef struct {
	Name        string
	Description string
	Signature   string
	Execute     func(args map[string]interface{}) string
}

func (c *CognitionLoop) getToolRegistry(excludeCmds []string) map[string]ToolDef {
	return map[string]ToolDef{
		"read_file": {
			Name:        "read_file",
			Description: "Gets the full or partial content of a file. Use start_line and end_line to chunk large files.",
			Signature:   `{"filename": "string", "start_line": "int", "end_line": "int"}`,
			Execute: func(args map[string]interface{}) string {
				path, _ := args["filename"].(string)
				b, err := os.ReadFile(path)
				if err != nil {
					return err.Error()
				}
				lines := strings.Split(string(b), "\n")

				startLine := 1
				endLine := len(lines)

				if sl, ok := args["start_line"].(float64); ok && sl > 0 {
					startLine = int(sl)
				}
				if el, ok := args["end_line"].(float64); ok && el > 0 && int(el) <= len(lines) {
					endLine = int(el)
				}

				if startLine > endLine || startLine > len(lines) {
					return "Invalid line range"
				}

				return strings.Join(lines[startLine-1:endLine], "\n")
			},
		},
		"list_files": {
			Name:        "list_files",
			Description: "Lists the files in a directory.",
			Signature:   `{"path": "string"}`,
			Execute: func(args map[string]interface{}) string {
				path, _ := args["path"].(string)
				entries, err := os.ReadDir(path)
				if err != nil {
					return err.Error()
				}
				var files []string
				for _, e := range entries {
					t := "file"
					if e.IsDir() {
						t = "dir"
					}
					files = append(files, fmt.Sprintf("%s (%s)", e.Name(), t))
				}
				return strings.Join(files, "\n")
			},
		},
		"edit_file": {
			Name:        "edit_file",
			Description: "Replaces first occurrence of old_str with new_str in file. If old_str is empty, create/overwrite file.",
			Signature:   `{"path": "string", "old_str": "string", "new_str": "string"}`,
			Execute: func(args map[string]interface{}) string {
				path, _ := args["path"].(string)
				oldStr, _ := args["old_str"].(string)
				newStr, _ := args["new_str"].(string)
				if oldStr == "" {
					if err := os.WriteFile(path, []byte(newStr), 0644); err != nil {
						return err.Error()
					}
					return "created_file"
				}
				b, err := os.ReadFile(path)
				if err != nil {
					return err.Error()
				}
				content := string(b)
				if !strings.Contains(content, oldStr) {
					return "old_str not found"
				}
				content = strings.Replace(content, oldStr, newStr, 1)
				if err := os.WriteFile(path, []byte(content), 0644); err != nil {
					return err.Error()
				}
				return "edited"
			},
		},
		"bash": {
			Name:        "bash",
			Description: "Executes a shell command.",
			Signature:   `{"command": "string"}`,
			Execute: func(args map[string]interface{}) string {
				cmd, _ := args["command"].(string)
				// Native command blocking!
				for _, excluded := range excludeCmds {
					ex := strings.TrimSpace(excluded)
					if ex != "" && strings.Contains(cmd, ex) {
						return fmt.Sprintf("Error: Command '%s' matches restricted pattern '%s'", cmd, ex)
					}
				}
				out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
				if err != nil {
					return fmt.Sprintf("Error: %v\nOutput: %s", err, string(out))
				}
				return string(out)
			},
		},
	}
}

func (c *CognitionLoop) Run(ctx context.Context, initialQuery string) (string, error) {
	logger.Info("Agent", "🧠 Cognition Loop started")

	personaText, activeToolNames, excludeCmds := c.loadPersonaConfig()
	reg := c.getToolRegistry(excludeCmds)

	repStr := ""
	for _, tName := range activeToolNames {
		tName = strings.TrimSpace(tName)
		if tool, ok := reg[tName]; ok {
			repStr += "TOOL\n===\n"
			repStr += fmt.Sprintf("Name: %s\nDescription: %s\nSignature: %s\n\n", tool.Name, tool.Description, tool.Signature)
		}
	}
	sysPrompt := strings.Replace(baseSystemPrompt, "{tool_list_repr}", repStr, 1)
	sysPrompt = strings.Replace(sysPrompt, "{persona_text}", personaText, 1)

	messages := []Message{{Role: "system", Content: sysPrompt}, {Role: "user", Content: initialQuery}}

	for i := 0; i < c.MaxSteps; i++ {
		response, err := c.Provider.ChatCompletion(ctx, messages)
		if err != nil {
			return "", fmt.Errorf("provider err: %v", err)
		}

		messages = append(messages, Message{Role: "assistant", Content: response.Content})

		toolName, toolArgs := extractToolInvocations(response.Content)
		if toolName != "" {
			if tool, exists := reg[toolName]; exists {
				if c.OnTool != nil {
					c.OnTool(toolName, toolArgs)
				}
				logger.Info("Agent", fmt.Sprintf("🛠 Executing %s args: %v", toolName, toolArgs))
				respStr := tool.Execute(toolArgs)
				messages = append(messages, Message{Role: "user", Content: fmt.Sprintf("tool_result(%s)", respStr)})
				continue
			}
			messages = append(messages, Message{Role: "user", Content: fmt.Sprintf("tool_result(error: tool '%s' not mapped)", toolName)})
			continue
		}
		logger.Info("Agent", "✅ Cognition Loop completed")
		return response.Content, nil
	}
	return "I hit my maximum reasoning steps limits.", nil
}

func (c *CognitionLoop) loadPersonaConfig() (string, []string, []string) {
	homeDir, _ := os.UserHomeDir()
	content, err := os.ReadFile(homeDir + "/.kendaliai/Persona.md")
	if err != nil {
		return "", []string{"bash", "read_file"}, nil
	}

	personaTxt := string(content)
	tools := []string{"bash", "read_file", "list_files", "edit_file"}
	excludes := []string{}

	lines := strings.Split(personaTxt, "\n")
	var cleaned []string
	for _, l := range lines {
		if strings.HasPrefix(l, "tools:") {
			tools = strings.Split(strings.TrimSpace(l[6:]), ",")
		} else if strings.HasPrefix(l, "exclude_cmd:") {
			excludes = strings.Split(strings.TrimSpace(l[12:]), ",")
		} else {
			cleaned = append(cleaned, l)
		}
	}
	return strings.Join(cleaned, "\n"), tools, excludes
}

func extractToolInvocations(text string) (string, map[string]interface{}) {
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if !strings.HasPrefix(line, "tool:") {
			continue
		}
		parts := strings.SplitN(strings.TrimSpace(line[5:]), "(", 2)
		if len(parts) == 2 {
			name := strings.TrimSpace(parts[0])
			jsonStr := strings.TrimSuffix(strings.TrimSpace(parts[1]), ")")
			var args map[string]interface{}
			if err := json.Unmarshal([]byte(jsonStr), &args); err == nil {
				return name, args
			}
		}
	}
	return "", nil
}
