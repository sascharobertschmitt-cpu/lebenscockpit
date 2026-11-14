#!/usr/bin/env python3
"""Fail CI when a migration creates a public table without explicit safety controls."""
import pathlib, re, sys
root = pathlib.Path("supabase/migrations")
files = sorted(root.glob("*.sql"))
if not files:
    print("No migration files: cannot verify schema changes", file=sys.stderr)
    sys.exit(1)
errors=[]
for path in files:
    sql = path.read_text(encoding="utf-8")
    # Ignore SQL comments for matching; conservative check (not a SQL parser).
    cleaned=re.sub(r"/\*.*?\*/|--[^\n]*", "", sql, flags=re.S)
    created=re.findall(r"\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?[\"\w]+",cleaned,re.I)
    if created:
        if not re.search(r"\balter\s+table\b.*?\benable\s+row\s+level\s+security\b",cleaned,re.I|re.S):
            errors.append(f"{path}: CREATE TABLE without ENABLE ROW LEVEL SECURITY")
        if not re.search(r"\bcreate\s+policy\b",cleaned,re.I):
            errors.append(f"{path}: CREATE TABLE without CREATE POLICY")
        if not re.search(r"\brevoke\s+.*?\btruncate\b",cleaned,re.I|re.S):
            errors.append(f"{path}: CREATE TABLE without REVOKE TRUNCATE")
for error in errors: print("SECURITY ERROR:",error,file=sys.stderr)
if errors: sys.exit(1)
print(f"Checked {len(files)} migration(s); no missing basic controls detected.")
