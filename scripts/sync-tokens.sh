#!/usr/bin/env bash
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/supershivas/design-system/main/design-tokens.json -o design-tokens.json
echo "design-tokens.json mis à jour depuis supershivas/design-system"
