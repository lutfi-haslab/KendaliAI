package db

import (
	"database/sql"
	"os"
	"path/filepath"

	"github.com/kendaliai/app/internal/config"
	_ "github.com/mattn/go-sqlite3"
)

func Initialize(cfg *config.Config) (*sql.DB, error) {
	dbPath := cfg.Database.Path
	if dbPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			homeDir = "."
		}
		dbPath = filepath.Join(homeDir, ".kendaliai", "kendaliai.db")
	}

	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	// Set pragmas
	if _, err := db.Exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;"); err != nil {
		return nil, err
	}

	if err := initTables(db); err != nil {
		return nil, err
	}

	return db, nil
}

func initTables(db *sql.DB) error {
	for _, query := range schemaQueries {
		if _, err := db.Exec(query); err != nil {
			return err
		}
	}
	return nil
}
