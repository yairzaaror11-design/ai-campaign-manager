#!/bin/zsh
# Saves an API key into this checkout's local .env (git-ignored) without
# showing it on screen or writing it to shell history.
# Usage: scripts/set-local-key.sh ANTHROPIC_API_KEY
set -euo pipefail
umask 077
NAME="${1:-}"
case "$NAME" in
  ANTHROPIC_API_KEY|GEMINI_API_KEY|HF_CREDENTIALS|GITHUB_TOKEN) ;;
  *) echo "שם לא מוכר. אפשר: ANTHROPIC_API_KEY, GEMINI_API_KEY, HF_CREDENTIALS, GITHUB_TOKEN" >&2; exit 1 ;;
esac
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
printf 'הדבק את המפתח ולחץ Enter (הוא לא יוצג): '
read -rs VALUE; echo
[[ -n "$VALUE" && "$VALUE" != *[[:space:]]* ]] || { echo "המפתח ריק או מכיל רווחים." >&2; exit 1; }
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
grep -v "^${NAME}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
printf '%s=%s\n' "$NAME" "$VALUE" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
unset VALUE
echo "נשמר: $NAME (בקובץ מקומי שלא עולה לגיטהאב)."
