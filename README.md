# Welwyn Hatfield Bowls League — Azure deployment guide

This is the same league app, restructured so it can run on your own Azure account
with real, working score storage (instead of Claude's preview-only storage).

- The website (`src/`) is a normal React app.
- The scores/fixtures live in an Azure Storage **Blob container**, read and written
  through three small Azure Functions in `api/`.
- Azure **Static Web Apps** hosts both the website and the API together, for free
  on the entry-level tier, and rebuilds automatically whenever you push changes
  to GitHub.

No coding knowledge is needed for the steps below — just some patience clicking
through the Azure Portal. It takes about 20–30 minutes the first time.

---

## Step 1 — Put the code on GitHub

1. Go to [github.com](https://github.com) and sign in (or create a free account).
2. Click **New repository**. Name it e.g. `wh-bowls-league`. Keep it **Private** if
   you'd rather the source code wasn't public (this doesn't affect who can visit
   the finished website).
3. On the new, empty repository page, click **uploading an existing file** and
   drag in this whole folder (or use GitHub Desktop if you have it — either
   works). Commit the files.

## Step 2 — Create the storage for scores

1. In the [Azure Portal](https://portal.azure.com), click **Create a resource** →
   search **Storage account** → **Create**.
2. Pick your subscription and resource group (create a new resource group called
   e.g. `bowls-league` if you don't have one), give it a unique name like
   `whbowlsstorage`, choose a region near you, and leave the other defaults.
   Click **Review + create**, then **Create**.
3. Once it's deployed, open the storage account → **Security + networking** →
   **Access keys** → click **Show** next to key1 → copy the **Connection string**.
   Keep this safe; you'll paste it into Azure in Step 4.
   *(You don't need to manually create the `league-data` container — the app
   creates it automatically the first time it runs.)*

## Step 3 — Create the Static Web App

1. In the Azure Portal, **Create a resource** → search **Static Web App** →
   **Create**.
2. Choose the same subscription/resource group, give it a name like
   `wh-bowls-league`, pick a region, and select the **Free** plan.
3. Under **Deployment details**, choose **GitHub**, sign in, and pick the
   organisation/repository/branch you created in Step 1.
4. Under **Build details**:
   - Build presets: **Custom**
   - App location: `/`
   - Api location: `api`
   - Output location: `dist`
5. Click **Review + create**, then **Create**. Azure will automatically add a
   GitHub Actions workflow file to your repository and start the first build —
   this typically takes 3–5 minutes.

## Step 4 — Connect the storage account

1. Once deployment finishes, open your new Static Web App resource → **Settings**
   → **Configuration**.
2. Click **Add**, name it `AZURE_STORAGE_CONNECTION_STRING`, and paste the
   connection string you copied in Step 2. Click **OK**, then **Save**.

## Step 5 — Visit your site

Open the Static Web App resource → **Overview** — you'll see a URL like
`https://calm-sand-0123456.azurestaticapps.net`. That's your live league site,
with real score-saving. Test it: enter a score in the Admin section, refresh
the page, and confirm it's still there.

---

## Putting it on your existing website

You have two options:

**Option A — use it as-is.** Add a custom domain (e.g. `league.yourclub.org.uk`)
to the Static Web App under **Custom domains**, and point your DNS at it. Then
link to it from your existing site's menu.

**Option B — embed it inside an existing page**, using an iframe:

```html
<iframe
  src="https://calm-sand-0123456.azurestaticapps.net"
  style="width:100%; height:1400px; border:0;"
  title="Welwyn Hatfield Bowls League">
</iframe>
```

(Swap in your actual Static Web App or custom domain URL, and adjust the height
to taste.)

---

## Passwords

The Admin and Team leader passwords are set in `src/App.jsx`:

```js
const ADMIN_PASSWORD = 'fish';
const TEAM_PASSWORD = 'chips';
```

Change them, commit, and push — the site rebuilds automatically. As before,
these are simple front-end checks, fine for keeping casual visitors from
editing results, but not real account security.

**Worth knowing:** the `/api/league` (write) and `/api/backup` endpoints are
currently open to anyone who finds the URL directly, bypassing the password
screens in the browser — same trust model as the passwords above. If you'd
like tighter protection later (e.g. proper login for admins, via Static Web
Apps' built-in authentication), that's a further step I'm happy to help with.

## Running it on your own computer first (optional)

If you want to try it locally before deploying:

```bash
npm install
cd api && npm install && cd ..
cp api/local.settings.json.example api/local.settings.json
# paste your storage connection string into api/local.settings.json
npm run dev
```

You'll also need the [Azure Static Web Apps CLI](https://learn.microsoft.com/azure/static-web-apps/local-development)
or [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
running alongside `npm run dev` for the `/api/*` calls to work locally.
