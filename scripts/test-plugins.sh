#!/bin/sh
# Run the process-gate regression fixtures (host Node only).
# Node >=22 no longer resolves a bare directory argument for --test; pass the
# test files explicitly (the glob is expanded by the shell).
set -eu
cd "$(dirname "$0")/.."
exec node --test plugins/tests/*.test.js
