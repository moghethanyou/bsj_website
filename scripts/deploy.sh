#!/usr/bin/env bash
#
# Publish the site to the OCF server.
#
#   ./scripts/deploy.sh            rebuild the data, then publish
#   ./scripts/deploy.sh --dry-run  show what would change, send nothing
#   ./scripts/deploy.sh --no-build publish what is on disk, skip the rebuild
#
# You will be asked for the OCF password unless an SSH key is set up.

set -euo pipefail

OCF_USER="${OCF_USER:-bsj}"
OCF_HOST="${OCF_HOST:-ssh.ocf.berkeley.edu}"
TARGET="${OCF_USER}@${OCF_HOST}:~/public_html/"

cd "$(dirname "$0")/.."

DRY_RUN=""
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ "$BUILD" = "1" ]; then
  echo "Rebuilding data files..."
  python3 scripts/build.py
  echo
fi

# Every exclude is anchored with a leading slash so it matches only at the top
# level. Without the slash, 'covers' would also match assets/covers and silently
# drop every issue cover from the upload.
#
# content/staff.json is NOT excluded: the Staff page fetches it at runtime, which
# is what lets the roster be edited without rebuilding anything. Only the Markdown
# sources under content/articles are left behind, since the build turns those into
# the JSON the site actually reads.
echo "Publishing to ${TARGET}"
rsync -av --delete ${DRY_RUN} \
  -e "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=6" \
  --exclude='/.git' \
  --exclude='/.github' \
  --exclude='/.gitignore' \
  --exclude='.DS_Store' \
  --exclude='/scripts' \
  --exclude='/content/articles' \
  --exclude='/ocf-backup' \
  --exclude='/ocf-site' \
  --exclude='/old_stuff' \
  --exclude='/covers' \
  --exclude='/media' \
  --exclude='/assets/data/articles.json' \
  --exclude='/EDITING.md' \
  --exclude='/README.md' \
  ./ "$TARGET"

if [ -n "$DRY_RUN" ]; then
  echo
  echo "Dry run only. Nothing was uploaded."
  exit 0
fi

echo
echo "Fixing permissions so the web server can read everything..."
ssh -o ServerAliveInterval=30 "${OCF_USER}@${OCF_HOST}" \
  'find ~/public_html/ -type d -exec chmod 755 {} \; ;
   find ~/public_html/ -type f -exec chmod 644 {} \; ;
   echo "  $(find ~/public_html/ -type f | wc -l | tr -d " ") files, $(du -sh ~/public_html/ | cut -f1)"'

echo
echo "Live at https://bsj.studentorg.berkeley.edu"
