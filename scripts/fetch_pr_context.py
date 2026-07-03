#!/usr/bin/env python3
"""Resolve external links in a PR body into a context file for the AI reviewer.

The PR description (env ``PR_BODY``) is scanned for Linear / Slack / Notion / Sentry
references. Each is fetched with the matching token from the environment and written
to ``.pr-context.md`` in the current directory. The reviewer reads that file to check
the PR against its source of truth — above all the Linear parent issue's acceptance
criteria.

Guarantees:
- Standard library only (no install step in CI).
- Every fetch is best-effort: a missing token skips the source, and any error is
  recorded as a note instead of failing the job — a review must run regardless.
- Tokens are never printed or written to the output file.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request

TIMEOUT = 20
MAX_SECTION_CHARS = 6000
OUTPUT_PATH = ".pr-context.md"
LINEAR_API = "https://api.linear.app/graphql"
# Bare identifiers (e.g. DRT-1234) are only treated as Linear issues for these team
# keys, so tokens like "UTF-8" or "SHA-256" are not mistaken for issues.
DEFAULT_TEAM_KEYS = "DRT"


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def truncate(text: str) -> str:
    text = text or ""
    if len(text) > MAX_SECTION_CHARS:
        return text[:MAX_SECTION_CHARS] + "\n…(생략됨)"
    return text


def post_json(url: str, headers: dict, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --- Linear -----------------------------------------------------------------

def linear_issue(key: str, number: int, token: str) -> dict | None:
    query = (
        "query($key:String!,$number:Float!){"
        "issues(filter:{team:{key:{eq:$key}},number:{eq:$number}},first:1){"
        "nodes{identifier title url state{name} description}}}"
    )
    res = post_json(LINEAR_API, {"Authorization": token},
                    {"query": query, "variables": {"key": key, "number": number}})
    nodes = (((res.get("data") or {}).get("issues") or {}).get("nodes")) or []
    return nodes[0] if nodes else None


def linear_document(slug_id: str, token: str) -> dict | None:
    query = "query($id:String!){document(id:$id){title content}}"
    res = post_json(LINEAR_API, {"Authorization": token},
                    {"query": query, "variables": {"id": slug_id}})
    return (res.get("data") or {}).get("document")


def find_linear_issue_idents(body: str, team_keys: set) -> list:
    idents = []
    for m in re.finditer(r"https?://linear\.app/[^/\s]+/issue/([A-Za-z0-9]+-\d+)", body):
        idents.append(m.group(1).upper())
    for m in re.finditer(r"\b([A-Z][A-Z0-9]*)-(\d+)\b", body):
        if m.group(1) in team_keys:
            idents.append(f"{m.group(1)}-{m.group(2)}")
    seen, out = set(), []
    for i in idents:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def find_parent_ident(body: str, team_keys: set):
    for line in body.splitlines():
        if re.search(r"parent", line, re.I):
            found = find_linear_issue_idents(line, team_keys)
            if found:
                return found[0]
    return None


# --- Slack -------------------------------------------------------------------

def find_slack_links(body: str) -> list:
    out = []
    pattern = r"https?://[\w.-]+\.slack\.com/archives/([A-Z0-9]+)/p(\d+)(?:\?[^\s)]*thread_ts=([\d.]+))?"
    for m in re.finditer(pattern, body):
        channel, pts, thread = m.group(1), m.group(2), m.group(3)
        ts = pts[:-6] + "." + pts[-6:] if len(pts) > 6 else pts
        out.append((channel, ts, thread, m.group(0)))
    return out


def slack_fetch(channel: str, ts: str, thread, token: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    root = thread or ts
    data = get_json(
        f"https://slack.com/api/conversations.replies?channel={channel}&ts={root}&limit=20",
        headers,
    )
    if not data.get("ok"):
        data = get_json(
            f"https://slack.com/api/conversations.history?channel={channel}"
            f"&latest={ts}&oldest={ts}&inclusive=true&limit=1",
            headers,
        )
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "unknown"))
    lines = []
    for msg in data.get("messages", []):
        who = msg.get("user") or msg.get("username") or "?"
        lines.append(f"- ({who}) {msg.get('text', '')}")
    return "\n".join(lines) or "(빈 메시지)"


# --- Notion ------------------------------------------------------------------

def find_notion_ids(body: str) -> list:
    out, seen = [], set()
    for m in re.finditer(r"https?://(?:www\.)?notion\.so/[^\s)]+", body):
        url = m.group(0)
        hexes = re.findall(r"[0-9a-fA-F]{32}", url.replace("-", ""))
        if hexes and hexes[-1] not in seen:
            seen.add(hexes[-1])
            out.append((hexes[-1], url))
    return out


def notion_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"}


def notion_title(page_id: str, token: str) -> str:
    try:
        page = get_json(f"https://api.notion.com/v1/pages/{page_id}", notion_headers(token))
        for prop in (page.get("properties") or {}).values():
            if prop.get("type") == "title":
                return "".join(t.get("plain_text", "") for t in prop.get("title", []))
    except Exception:
        pass
    return ""


def notion_text(page_id: str, token: str) -> str:
    data = get_json(
        f"https://api.notion.com/v1/blocks/{page_id}/children?page_size=50",
        notion_headers(token),
    )
    lines = []
    for block in data.get("results", []):
        btype = block.get("type")
        payload = block.get(btype)
        rich = payload.get("rich_text") if isinstance(payload, dict) else None
        if rich:
            text = "".join(t.get("plain_text", "") for t in rich)
            if text.strip():
                lines.append(text)
    return "\n".join(lines) or "(본문 블록 없음)"


# --- Sentry ------------------------------------------------------------------

def find_sentry_ids(body: str) -> list:
    out, seen = [], set()
    pattern = r"https?://(?:[\w-]+\.)?sentry\.io/(?:organizations/[^/]+/)?issues/(\d+)"
    for m in re.finditer(pattern, body):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            out.append((m.group(1), m.group(0)))
    return out


def sentry_fetch(issue_id: str, token: str) -> str:
    data = get_json(
        f"https://sentry.io/api/0/issues/{issue_id}/",
        {"Authorization": f"Bearer {token}"},
    )
    return (
        f"- title: {data.get('title')}\n"
        f"- culprit: {data.get('culprit')}\n"
        f"- count: {data.get('count')} / users: {data.get('userCount')}\n"
        f"- level: {data.get('level')} / status: {data.get('status')}\n"
        f"- lastSeen: {data.get('lastSeen')}\n"
        f"- permalink: {data.get('permalink')}"
    )


# --- main --------------------------------------------------------------------

def write(lines: list) -> None:
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")
    print(f"[fetch_pr_context] wrote {OUTPUT_PATH} ({len(lines)} lines)")


def main() -> None:
    body = env("PR_BODY")
    linear_token = env("LINEAR_API_KEY")
    slack_token = env("SLACK_BOT_TOKEN")
    notion_token = env("NOTION_API_KEY")
    sentry_token = env("SENTRY_API_TOKEN")
    team_keys = {
        k.strip().upper()
        for k in (env("LINEAR_TEAM_KEYS") or DEFAULT_TEAM_KEYS).split(",")
        if k.strip()
    }

    out = [
        "# 외부 컨텍스트 (PR 링크 자동 수집)",
        "",
        "> 워크플로가 PR 본문의 링크를 토큰으로 조회해 만든 자료. 리뷰의 근거로 사용하되,",
        "> 접근 실패 항목은 맨 아래 '수집 실패'에 표시됨(추측으로 메우지 말 것).",
        "",
    ]
    notes = []
    header_len = len(out)

    if not body:
        write(out + ["_PR 본문이 비어 있어 수집할 링크가 없습니다._"])
        return

    # Linear ------------------------------------------------------------------
    linear_idents = find_linear_issue_idents(body, team_keys)
    if linear_token and linear_idents:
        parent = find_parent_ident(body, team_keys)
        if parent and parent in linear_idents:
            linear_idents = [parent] + [i for i in linear_idents if i != parent]
        for idx, ident in enumerate(linear_idents):
            key, num = ident.rsplit("-", 1)
            is_parent = ident == parent or (parent is None and idx == 0)
            label = "Parent 이슈 (완결성 기준)" if is_parent else "참조 이슈"
            try:
                issue = linear_issue(key, int(num), linear_token)
                if not issue:
                    notes.append(f"Linear {ident} — 조회 결과 없음(권한/식별자 확인)")
                    continue
                state = (issue.get("state") or {}).get("name")
                out += [
                    f"## Linear — {label}: {issue.get('identifier')} {issue.get('title', '')}",
                    f"URL: {issue.get('url', '')} · 상태: {state}",
                    "",
                    truncate(issue.get("description") or "(본문 없음)"),
                    "",
                ]
            except Exception as e:
                notes.append(f"Linear {ident} — {type(e).__name__}: {e}")
        for m in re.finditer(r"https?://linear\.app/[^/\s]+/document/([^\s)]+)", body):
            slug_id = m.group(1).rsplit("-", 1)[-1]
            try:
                doc = linear_document(slug_id, linear_token)
                if doc:
                    out += [f"## Linear 문서 — {doc.get('title', '')}", "",
                            truncate(doc.get("content") or ""), ""]
            except Exception as e:
                notes.append(f"Linear document {slug_id} — {type(e).__name__}: {e}")
    elif linear_idents:
        notes.append("Linear 링크가 있으나 LINEAR_API_KEY 미설정 — 미조회")

    # Slack -------------------------------------------------------------------
    slack_links = find_slack_links(body)
    if slack_links and slack_token:
        for channel, ts, thread, url in slack_links:
            try:
                out += [f"## Slack — {channel}", url, "",
                        truncate(slack_fetch(channel, ts, thread, slack_token)), ""]
            except Exception as e:
                notes.append(f"Slack {url} — {type(e).__name__}: {e} (봇이 채널에 초대됐는지 확인)")
    elif slack_links:
        notes.append("Slack 링크가 있으나 SLACK_BOT_TOKEN 미설정 — 미조회")

    # Notion ------------------------------------------------------------------
    notion_ids = find_notion_ids(body)
    if notion_ids and notion_token:
        for pid, url in notion_ids:
            try:
                title = notion_title(pid, notion_token)
                out += [f"## Notion — {title or pid}", url, "",
                        truncate(notion_text(pid, notion_token)), ""]
            except Exception as e:
                notes.append(f"Notion {url} — {type(e).__name__}: {e} (통합에 페이지 공유됐는지 확인)")
    elif notion_ids:
        notes.append("Notion 링크가 있으나 NOTION_API_KEY 미설정 — 미조회")

    # Sentry ------------------------------------------------------------------
    sentry_ids = find_sentry_ids(body)
    if sentry_ids and sentry_token:
        for sid, url in sentry_ids:
            try:
                out += [f"## Sentry — issue {sid}", url, "",
                        truncate(sentry_fetch(sid, sentry_token)), ""]
            except Exception as e:
                notes.append(f"Sentry {url} — {type(e).__name__}: {e}")
    elif sentry_ids:
        notes.append("Sentry 링크가 있으나 SENTRY_API_TOKEN 미설정 — 미조회")

    if notes:
        out += ["## 수집 실패 / 접근 불가", ""] + [f"- {n}" for n in notes] + [""]
    if len(out) <= header_len:
        out.append("_수집된 외부 컨텍스트가 없습니다 (인식된 링크 없음)._")

    write(out)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never fail the job over context collection
        print(f"[fetch_pr_context] unexpected error: {type(e).__name__}: {e}")
        try:
            write(["# 외부 컨텍스트", "", f"_수집 중 오류: {type(e).__name__}_"])
        except Exception:
            pass
