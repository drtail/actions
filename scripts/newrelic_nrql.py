#!/usr/bin/env python3
"""Run a read-only NRQL query against New Relic and print JSON results.

Usage:
    python3 nrql.py "SELECT count(*) FROM Transaction SINCE 1 day ago"

Auth: NEW_RELIC_API_KEY (user key) from env. The account id is a fixed non-secret
identifier. Best-effort: any error is printed, never raised.
"""

import json
import os
import sys
import urllib.request

ACCOUNT_ID = 4740591  # Dr.Tail New Relic account (non-secret identifier)
NERDGRAPH = "https://api.newrelic.com/graphql"


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: nrql.py '<NRQL query>'")
        return
    key = (os.environ.get("NEW_RELIC_API_KEY") or "").strip()
    if not key:
        print("NEW_RELIC_API_KEY not set — skipping New Relic query")
        return
    nrql = sys.argv[1].replace("\\", "\\\\").replace('"', '\\"')
    query = (
        "{ actor { account(id: %d) { nrql(query: \"%s\") { results } } } }"
        % (ACCOUNT_ID, nrql)
    )
    req = urllib.request.Request(
        NERDGRAPH,
        data=json.dumps({"query": query}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "API-Key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"NRQL error: {type(e).__name__}: {e}")
        return
    account = (((data.get("data") or {}).get("actor") or {}).get("account") or {})
    results = (account.get("nrql") or {}).get("results")
    print(json.dumps(results if results is not None else data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
