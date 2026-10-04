# Opt-in pull request previews

PR creation and pushes do not create Cloudflare preview resources by default.
Both build and deploy require a same-repository, non-draft PR with the
`preview-approved` label. Only apply that label when a preview is wanted and
its quota/resource use is approved. A draft is not an approval.

A preview uses one D1 database per PR and uploads a Worker version. The gate
is not a billing cap. Check available quotas before opting in. This change
does not rewrite the existing storage/deployment architecture or fix its
other resource-isolation concerns.

Removing the label stops future builds/deploys. Cancel any already-running
workflow separately if you need it to stop. Closing the PR retains the
existing cleanup path. Removing the label alone does not delete its preview.

## Bootstrap

1. With owner approval, temporarily disable only `Pull request preview`.
2. Open and review this workflow PR while that workflow is disabled. The old
   `pull_request_target` base workflow would otherwise run on its creation.
3. Merge only with owner approval, verify the gated file is on `main`, then
   re-enable the workflow with approval.
4. Future fix PRs stay unlabelled by default. Do not apply `preview-approved`
   until an actual preview run is approved.

No production deployment or database migration is authorized by this gate.

Alternatively, the owner can approve the old workflow creating resources for
this one bootstrap PR, after its included quota/cost headroom is checked.
That exception does not authorize previews for subsequent fixes or merging.
