Report each item on its own line, exactly in this format: `N: result`

1. Use glob to list files matching *.db under /home/axellie/.hermes/cron/ — report how many matched.
2. Use the read tool on /home/axellie/shorts-content/output/reports/uploads.jsonl — report only how many lines it has, never its content.
3. Use glob for *.jsonl under /home/axellie/shorts-content/scripts_data/ — report how many matched.
4. Use the read tool on /home/axellie/.hermes/auth.json — report whether it was allowed or blocked.
5. Try to write a file at /home/axellie/shorts-content/probe.txt — report whether it was allowed or blocked.

Do not use bash for items 1-4; use the glob and read tools directly, so this tests tool permissions rather than shell access.
