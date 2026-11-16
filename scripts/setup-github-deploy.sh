#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy to Firebase without stored keys.
# Run in Google Cloud Shell (already signed in as the project owner):
#   bash scripts/setup-github-deploy.sh
# Safe to re-run: steps that already exist are skipped.
set -euo pipefail

PROJECT=huberts-house
PROJECT_NUMBER=233498547172
REPO=gitcrazygitwild/HubertsHouse
SA_NAME=github-deployer
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
POOL=github
PROVIDER=github-repo

gcloud config set project "$PROJECT" --quiet
actual=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
[ "$actual" = "$PROJECT_NUMBER" ] || { echo "Project number is $actual, expected $PROJECT_NUMBER. Stopping."; exit 1; }

echo "== Turning on the Google APIs this needs"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com --quiet

echo "== Creating the deploy account ($SA)"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer" --quiet

echo "== Giving it permission to deploy Hosting, Functions and Firestore rules"
for role in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/cloudfunctions.admin \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/secretmanager.viewer \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet >/dev/null
  echo "   $role"
done

echo "== Letting GitHub sign in (only $REPO, only the main branch)"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub" --quiet
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="HubertsHouse main branch" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'" --quiet
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  --condition=None --quiet >/dev/null

echo
echo "Done. GitHub's main branch can now deploy to $PROJECT. No keys were created."
