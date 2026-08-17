#!/usr/bin/env node
// Wait for the Vercel preview deployment of a specific commit to become ready.
//
// Matching on the commit SHA rather than the branch matters: a branch can have an
// older ready deployment from a previous push, and testing that one would verify
// the wrong code.
//
// Usage:
//   node scripts/wait-for-preview.mjs --sha <commit-sha> [--timeout 900] [--interval 15]
//
// Prints the ready preview URL on stdout. Exit codes:
//   0 ready, 1 build failed or was cancelled, 2 timed out, 3 no deployment found
//
// Env:
//   VERCEL_TOKEN       required
//   VERCEL_ORG_ID      required, team id (team_...)
//   VERCEL_PROJECT_ID  required, project id (prj_...)

const API = 'https://api.vercel.com'
const TERMINAL_FAILURES = new Set(['ERROR', 'CANCELED', 'DELETED'])

function parseArgs(argv) {
  const args = { sha: null, timeout: 900, interval: 15 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--sha') args.sha = next()
    else if (arg === '--timeout') args.timeout = Number(next())
    else if (arg === '--interval') args.interval = Number(next())
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!args.sha) throw new Error('--sha is required')
  return args
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function listDeployments(token, teamId, projectId) {
  const params = new URLSearchParams({
    projectId,
    teamId,
    limit: '40',
    target: 'preview',
  })
  const response = await fetch(`${API}/v6/deployments?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Vercel ${response.status}: ${body.slice(0, 500)}`)
  }
  const payload = await response.json()
  return Array.isArray(payload.deployments) ? payload.deployments : []
}

function matchesSha(deployment, sha) {
  const meta = deployment.meta ?? {}
  const candidates = [meta.githubCommitSha, meta.gitlabCommitSha, meta.bitbucketCommitSha]
  return candidates.some(
    (candidate) => typeof candidate === 'string' && candidate.toLowerCase() === sha.toLowerCase(),
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_ORG_ID
  const projectId = process.env.VERCEL_PROJECT_ID

  if (!token || !teamId || !projectId) {
    console.error('Missing VERCEL_TOKEN, VERCEL_ORG_ID, or VERCEL_PROJECT_ID')
    process.exit(2)
  }

  const deadline = Date.now() + args.timeout * 1000
  let everSeen = false

  while (Date.now() < deadline) {
    const deployments = await listDeployments(token, teamId, projectId)
    const match = deployments.find((deployment) => matchesSha(deployment, args.sha))

    if (match) {
      everSeen = true
      const state = match.readyState ?? match.state ?? 'UNKNOWN'

      if (state === 'READY') {
        console.log(`https://${match.url}`)
        process.exit(0)
      }

      if (TERMINAL_FAILURES.has(state)) {
        const inspector = match.inspectorUrl ?? `https://vercel.com/deployments/${match.uid}`
        console.error(`Preview deployment ${state} for ${args.sha}`)
        console.error(`Build logs: ${inspector}`)
        process.exit(1)
      }

      console.error(`Preview ${state}, waiting...`)
    } else {
      // Vercel can take a few seconds to register the deployment after a push.
      console.error(`No preview deployment for ${args.sha} yet, waiting...`)
    }

    await sleep(args.interval * 1000)
  }

  console.error(
    everSeen
      ? `Timed out after ${args.timeout}s waiting for the preview of ${args.sha} to be ready`
      : `Timed out after ${args.timeout}s: no preview deployment was ever created for ${args.sha}`,
  )
  process.exit(everSeen ? 2 : 3)
}

main().catch((error) => {
  console.error(String(error.stack ?? error))
  process.exit(2)
})
