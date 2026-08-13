Heroku deployment notes

Prerequisites
- Have the Heroku CLI installed and be logged in: `heroku login`.
- Git repo ready and committed. Ensure `Procfile` exists (it does).

Build & deploy (recommended flow)

1. Create app (only if you don't have one):

   heroku create my-pl2026-app

2. Push to Heroku (main or master branch):

   git push heroku main

3. If your app uses a Node build for the frontend, Heroku will run `heroku-postbuild` if present. Ensure `requirements.txt` and `Procfile` are present for Python/uvicorn.

4. Open the app:

   heroku open

Running migrations / logs

- View logs:

  heroku logs --tail

Notes & troubleshooting
- If `heroku auth:whoami` prints "not logged in", run `heroku login` and follow the browser flow.
- If deployment fails due to buildpack issues, ensure your root `package.json` has a `heroku-postbuild` script that builds the `frontend` into `frontend/dist` (already present in this repo). Example:

  "scripts": {
    "heroku-postbuild": "cd frontend && npm ci && npm run build"
  }

Security
- Do not commit secrets. Use `heroku config:set KEY=value` to set environment variables.

Rollback
- To rollback to previous release:

  heroku releases
  heroku releases:rollback v123

If you want, I can attempt a deploy from this environment, but the Heroku CLI here is unauthenticated — you'll need to run the final `git push heroku main` from your machine or log in here.
