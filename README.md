# Blindspot

A second-order cybernetics sketching tool where geometry persists only while observed.
The viewport acts as a gate: geometry that leaves and re-enters the frame mutates,
with magnitude scaled by how long it went unobserved.

See [plan_final.txt](plan_final.txt) for the full concept and the cluster-by-cluster
implementation plan.

## Stack

TypeScript · React · React Three Fiber (Three.js / WebGL) · Zustand · Vite · Vercel

## Getting started

```bash
npm install
npm run dev      # start the Vite dev server
```

Other scripts:

```bash
npm run build     # type-check + production build
npm run typecheck # type-check only
npm run preview   # preview the production build locally
```

## Status — Cluster A complete

- Vite + React + TypeScript scaffold
- R3F canvas with an orthographic 2D camera
- Infinite, zoom-adaptive dot-grid background
- Floating bottom-center tool dock (visual stub) and top-left status bar

Next: Cluster B — freehand drawing pipeline.

## Deploy (Vercel)

1. Create a GitHub repository and push this project:
   ```bash
   git remote add origin https://github.com/<you>/blindspot.git
   git push -u origin main
   ```
2. Import the repo at https://vercel.com/new — Vercel auto-detects Vite
   (build: `npm run build`, output: `dist`). Every push then gets a preview URL.
