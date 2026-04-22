package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
)

func getEncryptionKey() []byte {
	// 1. Try env variable KENDALIAI_KEY
	envKey := os.Getenv("KENDALIAI_KEY")
	if envKey != "" {
		hash := sha256.Sum256([]byte(envKey))
		return hash[:]
	}

	// 2. Machine specific derivation
	home := os.Getenv("HOME")
	user := os.Getenv("USER")
	machineID := fmt.Sprintf("%s-%s", home, user)
	
	hash := sha256.Sum256([]byte(machineID))
	return hash[:]
}

// Encrypt encrypts a string returning base64 format (iv:authTag:ciphertext)
func Encrypt(plaintext string) (string, error) {
	key := getEncryptionKey()

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}

	ciphertext := aesGCM.Seal(nil, nonce, []byte(plaintext), nil)
	
	// Split tag from the rest. The tag is the last 16 bytes of ciphertext in Go's AES-GCM.
	tagSize := aesGCM.Overhead()
	if len(ciphertext) < tagSize {
		return "", errors.New("ciphertext too short")
	}

	actualCipher := ciphertext[:len(ciphertext)-tagSize]
	authTag := ciphertext[len(ciphertext)-tagSize:]

	nonceB64 := base64.StdEncoding.EncodeToString(nonce)
	tagB64 := base64.StdEncoding.EncodeToString(authTag)
	cipherB64 := base64.StdEncoding.EncodeToString(actualCipher)

	return fmt.Sprintf("%s:%s:%s", nonceB64, tagB64, cipherB64), nil
}

// Decrypt decrypts a string formatted as iv:authTag:ciphertext
func Decrypt(encryptedData string) (string, error) {
	parts := strings.Split(encryptedData, ":")
	if len(parts) != 3 {
		return "", errors.New("invalid encrypted data format")
	}

	nonce, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}

	authTag, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}

	actualCipher, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", err
	}

	// Reconstruct sealed ciphertext = actualCipher + authTag
	ciphertext := append(actualCipher, authTag...)

	key := getEncryptionKey()
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// HashToken one-way hashes a string using SHA256
func HashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", hash)
}

// MaskValue masks a string except the last visibleChars
func MaskValue(value string, visibleChars int) string {
	if visibleChars < 0 {
		visibleChars = 4
	}
	if len(value) <= visibleChars {
		return strings.Repeat("*", max(len(value), 4))
	}
	
	maskAmt := len(value) - visibleChars
	return strings.Repeat("*", maskAmt) + value[len(value)-visibleChars:]
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
