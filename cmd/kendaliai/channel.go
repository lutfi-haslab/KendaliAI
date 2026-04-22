package main

import (
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/kendaliai/app/internal/db"
	"github.com/spf13/cobra"
)

var botToken string

var channelCmd = &cobra.Command{
	Use:   "channel",
	Short: "Manage messaging channels",
}

var channelBindCmd = &cobra.Command{
	Use:   "bind-telegram",
	Short: "Bind a Telegram bot to the gateway",
	Run: func(cmd *cobra.Command, args []string) {
		database, err := db.Initialize(cfg)
		if err != nil {
			fmt.Printf("Failed to initialize db: %v\n", err)
			os.Exit(1)
		}
		defer database.Close()

		if botToken == "" {
			fmt.Println("❌ Error: --bot-token is required to bind telegram")
			os.Exit(1)
		}

		channelId := "ch_" + uuid.New().String()[:8]
		configJson := fmt.Sprintf(`{"botToken": "%s"}`, botToken)

		_, err = database.Exec(`
			INSERT OR REPLACE INTO channels (id, type, name, config, enabled, status) 
			VALUES (?, 'telegram', 'telegram_bot', ?, 1, 'stopped')`,
			channelId, configJson)

		if err != nil {
			fmt.Printf("❌ Failed to bind channel: %v\n", err)
			return
		}

		fmt.Printf("✅ Telegram channel successfully bound! Run your gateway process to start polling.\n")
	},
}

func init() {
	channelBindCmd.Flags().StringVar(&botToken, "bot-token", "", "Telegram Bot Token from BotFather")
	channelCmd.AddCommand(channelBindCmd)
	rootCmd.AddCommand(channelCmd)
}
