'use strict';
// GitHub's create-ref operation is atomic: only one run can create this fixed ref.
// Never delete this ref. Even an interrupted/failed run consumes the attempt.
const LOCK_REF = 'refs/heads/gemini-listmodels-attempt-consumed-20261025';
async function claimOnce({ request = globalThis.fetch, token, repository, sha }) {
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(sha || '')) {
    return { claimed: false, reason: 'INVALID_LOCK_CONFIGURATION' };
  }
  let response;
  try {
    response = await request('https://api.github.com/repos/' + repository + '/git/refs', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'authorization': 'Bearer ' + token, 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
      body: JSON.stringify({ ref: LOCK_REF, sha })
    });
  } catch (_) { return { claimed: false, reason: 'LOCK_UNCERTAIN_NO_API_CALL' }; }
  if (response.status === 201) return { claimed: true, reason: 'LOCK_CREATED' };
  return { claimed: false, reason: response.status === 422 ? 'ALREADY_CONSUMED_OR_REF_REJECTED' : 'LOCK_UNCONFIRMED_NO_API_CALL' };
}
module.exports = { LOCK_REF, claimOnce };
