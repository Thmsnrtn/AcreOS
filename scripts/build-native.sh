#!/bin/bash

# AcreOS Native App Build Script
# This script builds the web app and syncs it with Capacitor

set -e

echo "Building AcreOS for native platforms..."

# Build the web app
echo "Step 1: Building web app..."
npm run build

# Sync with Capacitor
echo "Step 2: Syncing with Capacitor..."
npx cap sync

echo "Build complete!"
echo ""
echo "Next steps:"
echo "  - For iOS: npx cap open ios (requires macOS with Xcode)"
echo "  - For Android: npx cap open android (requires Android Studio)"
echo ""
echo "To add platforms (first time only):"
echo "  - npx cap add ios"
echo "  - npx cap add android"
