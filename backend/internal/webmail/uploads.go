package webmail

import (
	"encoding/base64"
	"errors"
	"mime"
	"net/http"
	"path"
	"strings"
	"unicode"
)

const MaxUploadBytes = 5 << 20

// Upload is an outgoing attachment. Validation normalizes filename/type and checks
// decoded size before any content is handed to the mail catcher.
type Upload struct {
	Name          string `json:"name"`
	ContentType   string `json:"content_type"`
	ContentBase64 string `json:"content_base64"`
}

var ErrUploadSize = errors.New("attachments must total at most 5 MiB")

// ValidateUploads treats filenames and MIME labels as untrusted input. Files are
// sent as attachments; declaring HTML or SVG never grants inline preview access.
func ValidateUploads(files []Upload) error {
	if len(files) > 10 {
		return errors.New("attach at most 10 files")
	}
	total := 0
	for i := range files {
		file := &files[i]
		if strings.ContainsFunc(file.Name, unicode.IsControl) {
			return errors.New("attachment names cannot contain control characters")
		}
		file.Name = strings.TrimSpace(path.Base(strings.ReplaceAll(file.Name, "\\", "/")))
		if file.Name == "" || file.Name == "." || file.Name == ".." || file.Name == "/" || len(file.Name) > 180 {
			return errors.New("use attachment names from 1 to 180 bytes")
		}
		if len(file.ContentBase64) > base64.StdEncoding.EncodedLen(MaxUploadBytes) {
			return ErrUploadSize
		}
		data, err := base64.StdEncoding.Strict().DecodeString(file.ContentBase64)
		if err != nil {
			return errors.New("attachment content must use valid base64")
		}
		total += len(data)
		if total > MaxUploadBytes {
			return ErrUploadSize
		}
		if file.ContentType == "" {
			file.ContentType = http.DetectContentType(data)
		}
		if len(file.ContentType) > 200 || strings.ContainsAny(file.ContentType, "\r\n") {
			return errors.New("invalid attachment content type")
		}
		kind, _, err := mime.ParseMediaType(file.ContentType)
		if err != nil || !strings.Contains(kind, "/") || strings.Contains(kind, "*") {
			return errors.New("invalid attachment content type")
		}
		file.ContentType = strings.ToLower(kind)
	}
	return nil
}

// PreviewType recognizes only browser-decoded raster formats from their bytes.
// SVG/HTML and mislabeled files remain downloadable but cannot execute inline.
func PreviewType(data []byte) string {
	kind := http.DetectContentType(data)
	switch kind {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return kind
	default:
		return ""
	}
}
