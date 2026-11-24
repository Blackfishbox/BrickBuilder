# Automatic web deployment to the existing Ubuntu server

The `Build and deploy web app` workflow runs on every push to `main`. GitHub's
hosted runner builds and type-checks the PWA. A repository self-hosted runner
on the BrickBuilder server receives only the finished static files and copies
them to `/var/www/brickbuilder`.

The deployment runner connects **outbound** to GitHub; GitHub does not SSH into
the server. No Google Authenticator/TOTP code, SSH private key or deployment
secret is stored in GitHub. The separate Android workflow still runs on pushes
to `main` and publishes its release to the closed `alpha` testing track.

## One-time server setup

Use an administrator session on the server. Install `rsync` and create a
dedicated, unprivileged account for the runner:

```sh
sudo apt-get update
sudo apt-get install -y rsync
sudo groupadd --system brickbuilder-web
sudo useradd --system --create-home --home-dir /opt/brickbuilder-deploy \
  --shell /bin/bash brickbuilder-deploy
sudo usermod -aG brickbuilder-web brickbuilder-deploy
sudo chgrp -R brickbuilder-web /var/www/brickbuilder
sudo find /var/www/brickbuilder -type d -exec chmod 2775 {} +
sudo find /var/www/brickbuilder -type f -exec chmod 664 {} +
sudo chmod 644 /var/www/brickbuilder/privacy.html
```

This grants the runner group write access to the web root so it can replace
static app files. The web server retains read access. Keep this runner dedicated
to this repository and deployment workflow; do not use it for untrusted
pull-request workflows.

## Register the runner with GitHub

1. Open the repository's **Settings → Actions → Runners** page.
2. Choose **New self-hosted runner**, then select **Linux x64**.
3. Create the runner directory and switch to its dedicated account:

   ```sh
   sudo -u brickbuilder-deploy -H mkdir -p /opt/brickbuilder-deploy/actions-runner
   sudo -iu brickbuilder-deploy
   cd /opt/brickbuilder-deploy/actions-runner
   ```

4. Follow GitHub's current download and extraction commands in that directory.
   Add the label `brickbuilder-web-deploy` to the `./config.sh` command GitHub
   provides. Use the short-lived registration token shown by GitHub only for
   this setup; do not commit or save that token. After configuration, run `exit`
   to return to the administrator account.
5. Install and start the generated service as an administrator:

   ```sh
   cd /opt/brickbuilder-deploy/actions-runner
   sudo ./svc.sh install brickbuilder-deploy
   sudo ./svc.sh start
   ```

The runner must be online and show the `brickbuilder-web-deploy` label before
the deployment job can start. It needs outbound HTTPS access to GitHub Actions.
No inbound firewall rule or Google Authenticator code is required.

## What each deployment changes

- The PWA is built on a GitHub-hosted runner, not on the server, avoiding the
  server's frontend-build memory limit.
- The built artifact deliberately omits `privacy.html`.
- The server copy uses `rsync` without `--delete`, and excludes root-level
  `privacy.html` again. The server-managed policy file is checked before and
  after deployment.
- API files, Apache configuration, the API process and the Google Play privacy
  URL are not modified.
- If the server runner is offline, the build artifact remains available in the
  GitHub Actions run for one day; the deployment job waits for a matching runner.

After installing the runner, push a commit to `main` or manually start
**Build and deploy web app** from the Actions page. The workflow runs the
Android release workflow separately as configured.
