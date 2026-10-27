SPLIT REVIEW MODE — this PR changes __LINES__ lines (lock files excluded). A single reviewer reading a diff this large misses issues, so split the work:

1. Run `gh pr diff` / `gh pr view` once to see the file list, and read `.pr-context.md` if it exists.
2. Use the Agent tool to launch these four reviewers IN PARALLEL (one message, four Agent calls). Give each the repo, the PR number, its perspective, and these rules: read `.pr-context.md`, README.md and the CI `cdk diff` comment (`<!-- cdk-diff -->`), open only the files relevant to its perspective, do not write files, and return findings as `[Pn]` + title + file:line + a short reason.
   - 계약: every Acceptance Criterion in the PR description and the linked Linear issue → 충족 / 부분 / 미충족 with file:line; substantive changes no AC asks for.
   - 배포 안전·데이터: replacement/deletion of stateful resources, removal policies, cdk import correctness, deploy ordering, deploy-guard implications, cdk diff comment vs PR claims.
   - 보안: IAM scope and OIDC trust, SG exposure, public access, secrets in code.
   - 가용성·비용: ECS deploy config, capacity vs one host, health checks/timeouts, alarm correctness, recurring cost added.
   Wait for all four results in this same turn — do not end your turn, and do not write the review file, until every reviewer has returned.
3. Verify every returned finding yourself by opening the cited code. Drop what you cannot confirm, merge duplicates, keep the highest valid priority.
4. Write ONE review in the normal output format below — same headers, badges and open-issues marker. Right under the decision header add the line: `분할 리뷰: 계약 · 배포 안전 · 보안 · 가용성·비용 (N줄)`.
