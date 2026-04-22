package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Database struct {
		Path string `json:"path"`
	} `json:"database"`
	DefaultProvider string `json:"defaultProvider"`
}

func LoadConfig() *Config {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}

	configPath := filepath.Join(homeDir, ".kendaliai", "config.json")
	file, err := os.Open(configPath)
	if err != nil {
		// return default if config does not exist
		return &Config{}
	}
	defer file.Close()

	var cfg Config
	decoder := json.NewDecoder(file)
	if err := decoder.Decode(&cfg); err != nil {
		return &Config{}
	}

	return &cfg
}
