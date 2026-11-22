package webmail

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
)

// credentialCipher decodes a 256-bit key supplied outside the database/repository.
func credentialCipher(key string) (cipher.AEAD, error) {
	raw, err := hex.DecodeString(key)
	if err != nil || len(raw) != 32 {
		return nil, errors.New("invalid webmail session key")
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// SealCredentials binds encrypted credentials to one session hash. Moving a value
// to another session row fails authentication even when the mailbox is the same.
func SealCredentials(key, session string, credentials Credentials) (string, error) {
	aead, err := credentialCipher(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	data, err := json.Marshal(credentials)
	if err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(aead.Seal(nonce, nonce, data, []byte(session))), nil
}

// OpenCredentials returns credentials only after nonce, ciphertext and session verification.
func OpenCredentials(key, session, sealed string) (Credentials, error) {
	var out Credentials
	aead, err := credentialCipher(key)
	if err != nil {
		return out, err
	}
	data, err := base64.RawStdEncoding.DecodeString(sealed)
	if err != nil || len(data) < aead.NonceSize() {
		return out, errors.New("invalid mailbox session")
	}
	raw, err := aead.Open(nil, data[:aead.NonceSize()], data[aead.NonceSize():], []byte(session))
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
