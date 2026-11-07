# Organiz

Free attendance tracker. Register people, create events (several per day, with times and repetition), collect replies and take the roll call (one by one, in a list, or from a CSV file), give people and events custom properties, then browse attendance by calendar, by event or by person. Each dashboard is shared through a single link.

Official instance: https://organiz.events

Organiz is free software under the AGPL-3.0 license. You can run your own copy, see [Self-hosting](#self-hosting).

## How it works

- **No backend code.** The app is a static site (Firebase Hosting) that talks directly to Firestore.
- **Free forever.** The Firebase project stays on the Spark plan, which has no billing account: if a quota is exceeded the service pauses until the next day, it never sends a bill.
- **Encrypted.** Each dashboard is one Firestore document holding compressed AES-256-GCM ciphertext. The secret is generated in the browser and only lives in the link, after the `#`, which browsers never send to servers. Firebase only ever sees encrypted data.
- **Edit link and read-only link.** `https://<host>/#/d/<docId>/<secret>` edits; `https://<host>/#/v/<docId>/<key>` only reads. HKDF derives the encryption key (the read link) and a write key from the secret. Each save reveals a proof that the security rules check against a hash stored by the previous save, so holding the read link does not allow writing. The rules also forbid listing or deleting documents.
- **Concurrent edits merge.** Every change is an intent ("mark Jean present") applied to the latest version. A save is accepted only if its revision is the stored one plus one; otherwise the app reloads the latest version, replays the pending edits and saves again.
- **Abuse protection without a server.** Creating a dashboard needs a small proof of work, computed in the browser while the name is typed and checked by the rules.

## Limits

- **A lost link means lost data**: nobody can recover the key. Use *Export* regularly as a backup (CSV, or JSON to restore into a new dashboard).
- Edits made offline are rebased and saved when the tab is still open. If the tab is closed while offline, they are lost when another device saved first.
- The local cache is wiped as a whole when any dashboard was last opened more than 30 days ago. Offline edits from an earlier visit that never reached the server are wiped with it (accepted: rare, and only after a month).
- A dashboard holds at most 5 MB of data before compression (900,000 bytes once compressed and encrypted). Beyond that, edits are not saved and the header says so.
- Access cannot be revoked from someone who already has the link.
- `.xlsx` files are not read directly: save them as CSV first.

## Self-hosting

You need a Firebase project on the free Spark plan. No billing account is needed.

1. Create a project in the [Firebase console](https://console.firebase.google.com) and stay on the Spark plan.
2. Enable Firestore, in *Standard* edition.
3. Add a web app (Project settings, Your apps) and copy its config.
4. Copy `.env.example` to `.env.local` and fill it in:
   - `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID`: from the web app config.
   - `VITE_SITE_URL`: the public origin of your site, without a trailing slash (for example `https://your-project.web.app`).
   - `VITE_SOURCE_URL` (optional): where your users get the source code.
   - `FIREBASE_HOSTING_SITE` (optional): the Hosting site id, if it is not the project's default site.
5. Install and deploy:

   ```sh
   npm install
   npx firebase login   # once
   npm run deploy       # build, then deploy hosting and firestore.rules
   ```

`npm run build` fails and names the missing variables if the required ones are not set. The deploy goes to the project given by `VITE_FIREBASE_PROJECT_ID`.

To use your own domain, add it in Firebase Hosting, then set `VITE_SITE_URL` to it and deploy again.

Restrict the browser API key to your site: in the Google Cloud Console, open APIs & Services, Credentials, edit the browser key and add your site as an allowed HTTP referrer. The key is public by design (the rules and the encryption protect the data), but a restriction stops others from using your quota.

The AGPL asks that users of a modified copy served over a network can get its source code (section 13). The home page footer links to `VITE_SOURCE_URL`, which defaults to this repository. If you modify the code, point it to your own source.

## Development

Requires Node 24 and Java 21 (for the Firestore emulator). The emulator needs no Firebase account and no `.env.local`.

```sh
npm install
npm run emulators    # local Firestore emulator on port 8180, UI on http://localhost:4000
npm run dev:emu      # app against the emulator, http://localhost:5173
npm run dev          # app against your Firebase project (needs .env.local)
npm test             # unit tests
npm run test:emulator # security rules + storage tests (starts the emulator)
npm run typecheck && npm run lint
```

### Home pages and SEO

- `npm run build` runs `vite build`, then `scripts/prerender.mjs`. The script renders the home page into `dist/en/` and `dist/fr/`, and writes `dist/404.html`, `dist/sitemap.xml` and `dist/robots.txt`, using `VITE_SITE_URL`. Search engines and link previews then see the text without running JavaScript.
- `/` sends visitors to `/en/` or `/fr/` (saved choice, else browser language), unless the link holds a dashboard (`/#/d/…`).
- To check the built site with its real headers (CSP, cache), run `npx firebase emulators:start --only hosting,firestore --project demo-organiz`. The site is then on http://localhost:5050.
- After a UI change, refresh the screenshots and link preview images with `npm run dev`, then `node scripts/marketing-images.mjs`.
- An inline script added to `index.html` needs its hash in the CSP of `firebase.json`. `npm test` fails otherwise.

## Releases

Every merge to `main` deploys the official instance, then publishes a GitHub Release from the Conventional Commits title of the pull request. The [Releases page](https://github.com/valentincre/organiz/releases) is the changelog. Read the `BREAKING CHANGE` notes before you update your own instance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[GNU AGPL-3.0-or-later](LICENSE). In short: you can use, study, change and share Organiz. If you share a modified version, or run one as a network service, you must offer its source code under the same license.
