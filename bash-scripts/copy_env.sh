#!/bin/bash

# Taken from the second sibling extension (docs/extension-structure.md; itself from the chrome-extension-boilerplate-react-vite reference):
# bootstrap .env from .example.env (no-op if .env already exists). set_global_env.sh also self-bootstraps,
# so this is mostly for manual use.
cd "$(dirname "$0")/.." || exit 1

if [[ ! -f .env && -f .example.env ]]; then
  cp .example.env .env
  echo ".env created from .example.env"
fi
