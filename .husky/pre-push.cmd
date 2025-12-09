@echo off
REM Husky pre-push hook for Windows

REM Check if any tags are being pushed
git for-each-ref --format="%%(refname)" refs/tags | findstr /R "refs/tags" >nul
if %errorlevel% equ 0 (
  echo 🔄 Tag detected! Updating CHANGELOG.md...
  call npm run changelog
  
  REM Check if CHANGELOG was modified
  git diff --quiet CHANGELOG.md
  if %errorlevel% neq 0 (
    echo 📝 CHANGELOG.md has been updated
    echo ⚠️  Please commit the updated CHANGELOG.md before pushing the tag
    echo    Run: git add CHANGELOG.md ^&^& git commit -m "chore: update CHANGELOG.md"
    exit /b 1
  ) else (
    echo ✅ CHANGELOG.md is up to date
  )
)

