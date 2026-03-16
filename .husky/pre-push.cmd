@echo off
@echo off
REM Husky pre-push hook for Windows
REM For tag pushes, only verify that CHANGELOG.md is already committed.
REM The developer should run `npm run changelog` and commit before tagging.

REM Detect if any tags are being pushed (pre-push receives refs on stdin,
REM but on Windows we approximate by checking existing tag refs)
git for-each-ref --format="%%(refname)" refs/tags | findstr /R "refs/tags" >nul
if %errorlevel% equ 0 (
  echo 🔄 Tag detected! Verifying CHANGELOG.md...

  git diff --quiet CHANGELOG.md
  if %errorlevel% neq 0 (
    echo ⚠️  CHANGELOG.md has local changes.
    echo    Please run: npm run changelog
    echo    Then: git add CHANGELOG.md ^&^& git commit -m "chore: update CHANGELOG.md"
    echo    Recreate or re-push the tag after committing.
    exit /b 1
  ) else (
    echo ✅ CHANGELOG.md is up to date for tag push.
  )
)
