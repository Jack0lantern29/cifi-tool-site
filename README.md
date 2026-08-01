# CIFI Farm Mission Optimizer - v11

This build adds three practical upgrades:

* local save/load using browser storage
* cleaner output section
* GitHub Pages deployment instructions

## What is new

* Your inputs now save automatically in the browser.
* Reloading the page restores your most recent setup.
* `Reset Inputs` now restores the built-in defaults for the site and clears the saved browser state.
* The output section has cleaner headings for mission distribution and totals/resources.

## Files

* `index.html` - page structure
* `styles.css` - styling
* `script.js` - optimiser logic and browser persistence
* `assets/ship.png` - artwork used by the theme

## Local use in VS Code

1. Extract the project folder somewhere easy, for example:
`C:\\\\\\\\Users\\\\\\\\jacks\\\\\\\\Documents\\\\\\\\cifi-optimizer-site`
2. Open that folder in VS Code.
3. Open `index.html` in your browser, or use Live Server.
4. Change your inputs and refresh the page to confirm they restore automatically.

## GitHub Pages deployment

These steps assume you already have Git installed on Windows and a GitHub account.

### 1\. Create the repository

1. Go to GitHub.
2. Create a new repository.
3. Make it public.
4. Name it something like `cifi-farm-mission-optimizer`.
5. Do not add a README from GitHub if you are uploading this folder as-is.

### 2\. Open the folder in VS Code terminal

In VS Code:

* Open `Terminal` -> `New Terminal`
* Make sure you are inside the project folder

### 3\. Run these commands

Replace `YOUR-USERNAME` with your GitHub username.

```bash
git init
git branch -M main
git add .
git commit -m "Initial CIFI optimizer site"
git remote add origin https://github.com/YOUR-USERNAME/cifi-farm-mission-optimizer.git
git push -u origin main
```

### 4\. Turn on GitHub Pages

1. Open the repository on GitHub.
2. Go to `Settings`.
3. Go to `Pages`.
4. Under `Build and deployment`, choose `Deploy from a branch`.
5. Set branch to `main`.
6. Set folder to `/ (root)`.
7. Save.

GitHub will publish the site at a URL like:
`https://YOUR-USERNAME.github.io/cifi-farm-mission-optimizer/`

### 5\. Update the live site later

Whenever you change the site files in VS Code, run:

```bash
git add .
git commit -m "Update optimizer site"
git push
```

## Notes

* Browser save/load is local to the browser and machine you used.
* `Reset Inputs` resets the site to its built-in defaults and clears the saved browser state.
* If you want cross-device saved setups later, the next step would be config import/export or a backend.

