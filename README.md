# screenshot.js

A small CLI for capturing webpage screenshots and comparing them pixel by pixel. Use it to spot visual regressions after deploys, theme or plugin updates, or any change that might alter how a page looks.

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
# Full-page screenshot (default) → example-com-YYYYMMDD-HHmmss.png
node screenshot.js capture https://example.com

# Custom output path
node screenshot.js capture https://example.com --out baseline.png

# Viewport crop (default 1280x720)
node screenshot.js capture https://example.com --viewport

# Custom viewport
node screenshot.js capture https://example.com --viewport 1024x768

# Run an init script after load (cookie banner, forms, navigation, …)
node screenshot.js capture https://example.com --init ./accept-cookies.js --out baseline.png

# Compare two images (prints stats)
node screenshot.js compare baseline.png after.png

# Write a visual diff and fail if >1% of pixels differ
node screenshot.js compare baseline.png after.png --out diff.png --threshold 1

# Exact color match (100 = most sensitive; default is 90)
node screenshot.js compare baseline.png after.png --out diff.png --sensitivity 100

# Machine-readable result
node screenshot.js compare baseline.png after.png --out diff.png --threshold 1 --json
```

`--threshold` is a percent: exit `1` if `Different` is greater. `--sensitivity` is 0–100 color pickiness (`100` = any color difference counts; `0` = ignore color differences). `--json` prints one JSON object instead of the human-readable summary.

### Init scripts (`--init`)

After the page loads, `--init` runs a CommonJS module that exports an async function receiving Playwright’s `page`. Use it to accept cookies, fill forms, or navigate before the screenshot:

```js
// accept-cookies.js
module.exports = async (page) => {
  await page.locator('#onetrust-accept-btn-handler').click();
};

// multi-step.js
module.exports = async (page) => {
  await page.locator('#accept-cookies').click();
  await page.fill('#email', 'test@example.com');
  await page.click('button[type=submit]');
  await page.waitForURL('**/account');
};
```

```bash
node screenshot.js capture https://example.com --init ./accept-cookies.js
node screenshot.js capture https://example.com --init ./multi-step.js --out account.png
```

## Docker

Pull the image (or build from this repo with `docker build -t urlund/screenshotjs .`):

```bash
docker pull urlund/screenshotjs
```

### docker run

Mount a host folder to `/work` so screenshots land on your machine:

```bash
mkdir -p screenshots

# Full-page capture
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  capture https://example.com

# Custom output path (written into ./screenshots)
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  capture https://example.com --out baseline.png

# Viewport crop
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  capture https://example.com --viewport

# Custom viewport
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  capture https://example.com --viewport 1024x768

# Init script (mount the .js file into /work)
docker run --rm \
  -v "$PWD/screenshots:/work" \
  -v "$PWD/accept-cookies.js:/work/accept-cookies.js:ro" \
  urlund/screenshotjs capture https://example.com --init accept-cookies.js --out baseline.png

# Compare two images
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  compare baseline.png after.png

# Visual diff + fail if >1% different
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  compare baseline.png after.png --out diff.png --threshold 1
```

To capture a site running on your host machine (e.g. local WordPress):

```bash
docker run --rm -v "$PWD/screenshots:/work" urlund/screenshotjs \
  capture http://host.docker.internal:8080
```

### Docker Compose

[`docker-compose.yml`](docker-compose.yml) mounts `./screenshots` to `/work` and enables `host.docker.internal`. Args after the service name go to the CLI:

```bash
mkdir -p screenshots

docker compose run -q --rm screenshot \
  capture https://example.com

docker compose run -q --rm screenshot \
  capture https://example.com --out baseline.png

docker compose run -q --rm screenshot \
  capture https://example.com --viewport 1024x768

docker compose run -q --rm screenshot \
  compare baseline.png after.png --out diff.png --threshold 1

# Local WordPress on the host
docker compose run -q --rm screenshot \
  capture http://host.docker.internal:8080
```

For `--init`, uncomment the init-script volume in `docker-compose.yml` (or add your own), then:

```bash
docker compose run -q --rm screenshot \
  capture https://example.com --init accept-cookies.js --out baseline.png
```

## Example

The [`examples/`](examples/) folder includes two small HTML pages (`demo-before.html` and `demo-after.html`) that mimic a UI before and after a theme change. Capture both at the same viewport size, then compare:

```bash
# Default sensitivity (90) — pale background shifts may not register
node screenshot.js compare examples/before.png examples/after.png --out examples/diff-default.png

# Max sensitivity — catches pale background shifts
node screenshot.js compare examples/before.png examples/after.png --out examples/diff-sensitive.png --sensitivity 100
```

Sample output (default):

```
Compared 640×400 (256,000 px)
  Different:      9,359 px  (3.66%)
  Matching:     246,641 px  (96.34%)
  Sensitivity: 90
  Diff written: examples/diff-default.png
```

Sample output (`--sensitivity 100`):

```
Compared 640×400 (256,000 px)
  Different:    181,565 px  (70.92%)
  Matching:      74,435 px  (29.08%)
  Sensitivity: 100
  Diff written: examples/diff-sensitive.png
```

| Before | After |
| --- | --- |
| ![Before](examples/before.png) | ![After](examples/after.png) |

| Diff (default) | Diff (`--sensitivity 100`) |
| --- | --- |
| ![Diff default](examples/diff-default.png) | ![Diff sensitive](examples/diff-sensitive.png) |

The first diff highlights larger changes (heading copy, button color, card border). The second also flags the pale gray-vs-mint background because `--sensitivity 100` treats any color difference as a mismatch.