#!/bin/sh
# Run the process-gate regression fixtures (host Node only).
set -eu
cd "$(dirname "$0")/.."
exec node --test plugins/tests/
