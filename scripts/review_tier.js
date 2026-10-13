// PR 크기(추가+삭제 라인, lock 파일 제외)로 리뷰 모델·effort 를 고른다 (DRT-6998).
// actions/github-script 스텝에서 require 해 쓴다:
//   const pick = require(`${process.env.ACTION_DIR}/../scripts/review_tier.js`);
//   await pick({ github, context, core, profile: 'small' });
// outputs: model, effort, lines

const LOCK_FILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb',
  'uv.lock', 'poetry.lock', 'Pipfile.lock', 'Gemfile.lock', 'Podfile.lock',
  'go.sum', 'Cargo.lock', 'composer.lock',
]);

const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';

// [상한 라인 수(이하), 모델, effort] — 위에서부터 첫 매치. 마지막 행은 상한 없음.
const TIERS = {
  small: [
    [200, SONNET, 'medium'],
    [500, SONNET, 'high'],
    [Infinity, OPUS, 'high'],
  ],
  big: [
    [2000, OPUS, 'high'],
    [Infinity, OPUS, 'xhigh'],
  ],
};

function tierFor(profile, lines) {
  const [, model, effort] = TIERS[profile].find(([max]) => lines <= max);
  return { model, effort };
}

module.exports = async ({ github, context, core, profile }) => {
  if (!TIERS[profile]) throw new Error(`unknown review tier profile: ${profile}`);

  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.issue.number,
    per_page: 100,
  });
  const lines = files
    .filter((f) => !LOCK_FILES.has(f.filename.split('/').pop()))
    .reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const { model, effort } = tierFor(profile, lines);
  core.setOutput('model', model);
  core.setOutput('effort', effort);
  core.setOutput('lines', String(lines));
  console.log(`[review-tier] profile=${profile} lines=${lines} → ${model} / ${effort}`);
};

module.exports.tierFor = tierFor;
