// Strict model-output contract shared by posting and approval evaluation.
module.exports = (review, expectedSha, ignoreCount = 0) => {
  if (typeof review !== 'string' || !review.trim()) {
    throw new Error('Review output must be nonempty.');
  }
  const text = review.replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');
  const header = /^## (❌ REQUEST CHANGES|💬 COMMENT|✅ APPROVED)$/;
  const decision = lines[0].match(header)?.[1];
  if (!decision || lines.filter((line) => header.test(line)).length !== 1) {
    throw new Error('Review requires exactly one canonical decision header first.');
  }
  const issues = lines.at(-2)?.match(/^<!-- open-issues: P1=(\d+) P2=(\d+) -->$/);
  if (!issues || (text.match(/<!--\s*open-issues:/g) || []).length !== 1) {
    throw new Error('Review requires one exact open-issues marker before its SHA.');
  }
  if (!/^[a-f0-9]{40}$/i.test(expectedSha)
      || lines.at(-1) !== `<!-- reviewed-sha: ${expectedSha} -->`
      || (text.match(/<!--\s*reviewed-sha:/g) || []).length !== 1) {
    throw new Error('Review SHA marker must match the captured PR head exactly.');
  }
  const p1 = Number(issues[1]);
  const p2 = Number(issues[2]);
  if (!Number.isSafeInteger(p1) || !Number.isSafeInteger(p2)) {
    throw new Error('Open issue counts must be safe nonnegative integers.');
  }
  if (!Number.isSafeInteger(ignoreCount) || ignoreCount < 0) {
    throw new Error('Ignore count must be a safe nonnegative integer.');
  }
  if (p1 === 0 && p2 === 0
      && !lines.slice(1, -2).includes('No open P1/P2 issues.')) {
    throw new Error('Zero open issues require an explicit none statement.');
  }
  if (decision === '❌ REQUEST CHANGES' && p1 === 0 && p2 === 0) {
    throw new Error('REQUEST CHANGES conflicts with zero open issues.');
  }
  if (decision !== '❌ REQUEST CHANGES' && (p1 > 0 || p2 > ignoreCount)) {
    throw new Error('Passing decision conflicts with unignored open issues.');
  }
  return { decision, p1, p2 };
};
