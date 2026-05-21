#!/bin/bash
# AURA Root Reorganization Script
# Run from: /home/tensorttx/Projects/AURA_CHAT/AURA_CHAT

echo "🗂️  AURA Root Reorganization"
echo "============================"

# Create directories
mkdir -p legacy scripts/migration

# Robust move function
move_file() {
  local src="$1"
  local dest_dir="$2"
  if [ -f "$src" ]; then
    # Check if tracked by git
    if git ls-files --error-unmatch "$src" >/dev/null 2>&1; then
      git mv "$src" "$dest_dir"
      echo "  ✅ [Git] $src → $dest_dir"
    else
      mv "$src" "$dest_dir"
      echo "  ✅ [Local] $src → $dest_dir"
    fi
  fi
}

# Robust remove function
remove_file() {
  local src="$1"
  if [ -f "$src" ]; then
    if git ls-files --error-unmatch "$src" >/dev/null 2>&1; then
      git rm -f "$src"
      echo "  ✅ [Git RM] $src"
    else
      rm -f "$src"
      echo "  ✅ [Local RM] $src"
    fi
  fi
}

# Move legacy Python files → legacy/
LEGACY_FILES=(
  server.py
  behavior_engine.py
  behavior_engine_consumer.py
  emotional_router.py
  sensing_engine.py
  chroma_service.py
  degradation.py
  memory_sync.py
  proactive_engine.py
  relationship_tracker.py
  response_director.py
  batch_extract.py
  test_demo_flow.py
)

for f in "${LEGACY_FILES[@]}"; do
  move_file "$f" legacy/
done

# Move one-time migration scripts → scripts/migration/
MIGRATION_FILES=(
  fix_imports.py
  fix_ts_errors.py
  generate_sarvam.py
  copy_files.sh
  move_files.sh
)

for f in "${MIGRATION_FILES[@]}"; do
  move_file "$f" scripts/migration/
done

# Move stray test/doc files
move_file "test_runner.py" legacy/
move_file "test_withdrawal.json" legacy/
move_file "voice_diagnosis.md" docs/

# Remove duplicate full_arch_description.md (already in docs/)
if [ -f "full_arch_description.md" ] && [ -f "docs/full_arch_description.md" ]; then
  remove_file "full_arch_description.md"
fi

# Clean up __pycache__ at root
[ -d "__pycache__" ] && rm -rf __pycache__ && echo "  ✅ Removed __pycache__/"

echo ""
echo "============================"
echo "✅ Reorganization complete."
echo ""
echo "Run: git status"
echo "Then: git commit -m 'chore: reorganize root — move legacy + migration files'"
