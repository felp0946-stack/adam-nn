Image rules (enforce before sending to LLM):
- Accepted MIME types: image/jpeg, image/png, image/webp only — transcode SVG/BMP/HEIC first
- For animated images (GIF/APNG/animated WEBP), extract frame 1 only
- Resize before encoding — avoid multi-MB base64 payloads
- Don't send blank or solid-colour images (use a real photo/drawing when testing vision)
Backend converts all uploaded images to JPEG (max 1568px) in files_util.image_to_jpeg_b64.
