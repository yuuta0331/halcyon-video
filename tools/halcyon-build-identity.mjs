// Truthful build identity for the JP-4A console.
// GitHub `pull_request` workflows set GITHUB_SHA to the merge ref, not the
// PR head. Callers must pass HALCYON_SOURCE_HEAD_SHA when those differ.

export function sliceSha(value) {
  if (value == null) return '';
  const text = String(value).trim();
  return text ? text.slice(0, 40) : '';
}

export function resolveHalcyonBuildIdentity(env = {}, gitHead = '') {
  const source = sliceSha(env.HALCYON_SOURCE_HEAD_SHA)
    || sliceSha(gitHead)
    || sliceSha(env.GITHUB_SHA)
    || sliceSha(env.VERCEL_GIT_COMMIT_SHA)
    || 'unknown';
  const tested = sliceSha(env.HALCYON_TESTED_SHA)
    || sliceSha(env.GITHUB_SHA)
    || sliceSha(env.VERCEL_GIT_COMMIT_SHA)
    || source;
  return {
    sourceHeadSha: source,
    testedSha: tested,
    sourceIsExactHead: source === tested,
  };
}

export function readGitHead(execFileSync, cwd) {
  try {
    return String(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })).trim();
  } catch {
    return '';
  }
}

export function formatJp4aBuildLabels(identity) {
  const source = identity?.sourceHeadSha || 'unknown';
  const tested = identity?.testedSha || source;
  const same = source === tested;
  return {
    sourceHead: source,
    testedSha: tested,
    checkoutLabel: same ? 'same as source' : tested,
    exactSourceHeadClaim: same,
  };
}
