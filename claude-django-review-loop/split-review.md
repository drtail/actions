SPLIT REVIEW MODE — this PR changes __LINES__ lines (lock files excluded). A single reviewer reading a diff this large misses issues, so split the work:

1. Run `gh pr diff` / `gh pr view` once to see the file list, and read `.pr-context.md` if it exists.
2. Use the Agent tool to launch these four reviewers IN PARALLEL (one message, four Agent calls). Give each the repo, the PR number, its perspective, and these rules: read `.pr-context.md` and the project's CLAUDE.md, open only the files relevant to its perspective, do not write files, and return findings as `[Pn]` + title + file:line + a short reason.
   - 계약: every Acceptance Criterion in the PR description and the linked Linear issue → 충족 / 부분 / 미충족 with file:line; substantive changes no AC asks for.
   - DB 쿼리 효율: N+1, select_related / prefetch_related coverage, redundant queries, missing bulk operations — trace ViewSet → Serializer → nested serializers.
   - 아키텍처·보안: layer boundaries per CLAUDE.md, authentication / permission gaps, injection, sensitive data exposure.
   - 정확성·테스트: logic bugs, edge cases, error paths, async/transaction ordering, missing tests for key status codes.
3. Verify every returned finding yourself by opening the cited code. Drop what you cannot confirm, merge duplicates, keep the highest valid priority.
4. Write ONE review in the normal output format below — same headers, badges and open-issues marker. Right under the decision header add the line: `분할 리뷰: 계약 · DB 쿼리 · 아키텍처·보안 · 정확성·테스트 (N줄)`.
