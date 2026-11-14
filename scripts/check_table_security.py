#!/usr/bin/env python3
"""Conservative migration guard: review new public tables before merging."""
import pathlib
import re
import sys

root = pathlib.Path("supabase/migrations")
files = sorted(root.glob("*.sql"))
if not files:
    print("No migration files found", file=sys.stderr)
    sys.exit(1)

errors = []
for path in files:
    sql = path.read_text(encoding="utf-8")
    sql = re.sub(r"/\*.*?\*/|--[^\n]*", "", sql, flags=re.S)
    # This intentionally fails closed for CREATE TABLE; manual review is required
    # for advanced SQL, dynamic SQL, quoted identifiers or non-public schemas.
    matches = list(re.finditer(r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(public)\.)?(\"?[a-zA-Z_][\w]*\"?)", sql, re.I))
    for m in matches:
        table = m.group(2).strip('"')
        if m.group(1) is None and table.lower() in ("if", "select"):
            errors.append(f"{path}: unsupported CREATE TABLE syntax: manual review required")
            continue
        # Every created table must be explicitly handled. For simplicity,
        # require named public tables and explicit security statements.
        if m.group(1) is None:
            errors.append(f"{path}: CREATE TABLE {table}: use explicit public schema and review")
            continue
        ident = r'(?:public\.)?["]?' + re.escape(table) + r'["]?'
        if not re.search(r"\bALTER\s+TABLE\s+" + ident + r"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\b", sql, re.I):
            errors.append(f"{path}: {table}: missing RLS enable")
        if not re.search(r"\bCREATE\s+POLICY\b[^;]*\bON\s+" + ident + r"\b", sql, re.I | re.S):
            errors.append(f"{path}: {table}: missing policy")
        if not re.search(r"\bREVOKE\s+[^;]*\bTRUNCATE\b[^;]*\bON\s+(?:TABLE\s+)?" + ident + r"\b[^;]*\bFROM\b[^;]*\banon\b[^;]*\bauthenticated\b", sql, re.I | re.S):
            errors.append(f"{path}: {table}: missing TRUNCATE revoke from anon and authenticated")
for error in errors:
    print("SECURITY ERROR:", error, file=sys.stderr)
if errors:
    sys.exit(1)
print(f"Checked {len(files)} migrations; basic table controls present.")
