package main

import (
	"fmt"
	"os"

	"github.com/kendaliai/app/internal/db"
	"github.com/kendaliai/app/internal/gateways"
	"github.com/spf13/cobra"
)

var (
	onboardProvider string
	onboardModel    string
	onboardApiKey   string
)

var onboardCmd = &cobra.Command{
	Use:   "onboard",
	Short: "Quick setup wizard",
	Run: func(cmd *cobra.Command, args []string) {
		database, err := db.Initialize(cfg)
		if err != nil {
			fmt.Printf("Failed to initialize db: %v\n", err)
			os.Exit(1)
		}
		defer database.Close()

		if onboardApiKey == "" {
			onboardApiKey = os.Getenv("DEEPSEEK_API_KEY")
		}

		// Translating flags back into slice to reuse current HandleOnboard cleanly
		var passArgs []string
		if onboardProvider != "" { passArgs = append(passArgs, "--provider", onboardProvider) }
		if onboardModel != "" { passArgs = append(passArgs, "--model", onboardModel) }
		if onboardApiKey != "" { passArgs = append(passArgs, "--api-key", onboardApiKey) }

		gateways.HandleOnboard(database, passArgs)
	},
}

func init() {
	onboardCmd.Flags().StringVar(&onboardProvider, "provider", "deepseek", "AI Provider name")
	onboardCmd.Flags().StringVarP(&onboardModel, "model", "m", "deepseek-chat", "AI Model name")
	onboardCmd.Flags().StringVar(&onboardApiKey, "api-key", "", "Provider API Key (defaults to DEEPSEEK_API_KEY env)")
	rootCmd.AddCommand(onboardCmd)
}
