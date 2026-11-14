#!/usr/bin/env python3
"""Regression tests for the migration guard."""
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check_table_security.py").resolve()
SAFE = """
CREATE TABLE public.safe_items (id bigint);
ALTER TABLE public.safe_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY members ON public.safe_items FOR SELECT TO authenticated USING (true);
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.safe_items FROM anon, authenticated;
"""

def check(sql):
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        (root / "supabase" / "migrations").mkdir(parents=True)
        (root / "supabase" / "migrations" / "test.sql").write_text(sql, encoding="utf-8")
        return subprocess.run([sys.executable, str(SCRIPT)], cwd=root, capture_output=True, text=True)

class MigrationGuardTests(unittest.TestCase):
    def test_safe_table_passes(self):
        self.assertEqual(check(SAFE).returncode, 0)
    def test_missing_rls_fails(self):
        self.assertNotEqual(check(SAFE.replace("ALTER TABLE public.safe_items ENABLE ROW LEVEL SECURITY;", "")).returncode, 0)
    def test_missing_policy_fails(self):
        self.assertNotEqual(check(SAFE.replace("CREATE POLICY members ON public.safe_items FOR SELECT TO authenticated USING (true);", "")).returncode, 0)
    def test_missing_revoke_fails(self):
        self.assertNotEqual(check(SAFE.replace("REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.safe_items FROM anon, authenticated;", "")).returncode, 0)
    def test_other_table_controls_do_not_mask_unsafe_table(self):
        self.assertNotEqual(check(SAFE + "\\nCREATE TABLE public.unsafe_items (id bigint);").returncode, 0)
    def test_comments_do_not_count(self):
        self.assertNotEqual(check("CREATE TABLE public.unsafe_items (id bigint); -- ENABLE ROW LEVEL SECURITY CREATE POLICY REVOKE TRUNCATE").returncode, 0)

if __name__ == "__main__":
    unittest.main()
