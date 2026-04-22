package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
)

var logsCmd = &cobra.Command{
	Use:   "logs",
	Short: "Stream global system logs from KendaliAI (Telegram, TUI, Gateway)",
	Run: func(cmd *cobra.Command, args []string) {
		homeDir, _ := os.UserHomeDir()
		logPath := filepath.Join(homeDir, ".kendaliai", "system.log")
		
		if _, err := os.Stat(logPath); os.IsNotExist(err) {
			fmt.Println("No system logs found at", logPath)
			return
		}

		fmt.Printf("📡 Streaming logs from %s...\n\n", logPath)
		tailCmd := exec.Command("tail", "-f", logPath)
		tailCmd.Stdout = os.Stdout
		tailCmd.Stderr = os.Stderr
		
		if err := tailCmd.Run(); err != nil {
			fmt.Printf("Error tailing logs: %v\n", err)
		}
	},
}

func init() {
	rootCmd.AddCommand(logsCmd)
}
