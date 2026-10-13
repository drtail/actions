// PR 크기(추가+삭제 라인, lock 파일 제외)로 리뷰 모델·effort 를 고른다 (DRT-6998).
// actions/github-script 스텝에서 require 해 쓴다:
//   const pick = require(`${process.env.ACTION_DIR}/../scripts/review_tier.js`);
//   await pick({ github, context, core, profile: 'small' });
// outputs: model, effort, lines, split ('true' = 관점별 분할 리뷰 대상, DRT-6999)

const LOCK_FILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb',
  'uv.lock', 'poetry.lock', 'Pipfile.lock', 'Gemfile.lock', 'Podfile.lock',
  'go.sum', 'Cargo.lock', 'composer.lock',
]);

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';

// [상한 라인 수(이하), 모델, effort] — 위에서부터 첫 매치. 마지막 행은 상한 없음.
const TIERS = {
  small: [
    [200, HAIKU, 'medium'],
    [500, SONNET, 'high'],
    [Infinity, OPUS, 'high'],
  ],
  big: [
    [2000, OPUS, 'high'],
    [Infinity, OPUS, 'xhigh'],
  ],
};

// 이 라인 수를 넘으면 한 리뷰어가 diff 전체를 보지 않고 관점별로 나눠 본다 (DRT-6999).
// 큰 diff 일수록 단일 리뷰 품질이 급락한다 (arXiv 2606.15689). big 프로필은 완결성 리뷰라 분할하지 않는다.
const SPLIT_ABOVE = { small: 500 };

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
  const split = lines > (SPLIT_ABOVE[profile] ?? Infinity);
  core.setOutput('lines', String(lines));
  core.setOutput('split', String(split));
  console.log(`[review-tier] profile=${profile} lines=${lines} → ${model} / ${effort}${split ? ' / split' : ''}`);
  return { model, effort, lines, split };
};

module.exports.tierFor = tierFor;
