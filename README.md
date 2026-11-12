# ArcSite Studio — Interactive Architecture Site Plan & Asset Navigator

A full-stack project management, interactive CAD site-plan mapping, and multi-format architectural document viewer application built with **Node.js, Express, SQLite (`better-sqlite3`), Vanilla ES6+**, **PDF.js Vector Geometry Extraction**, and **In-Browser SlimSAM (WebGPU / ONNX WASM)**.

---

## Core Capabilities

### 1. Project & Workspace Security
- **User Accounts & Authentication**: Email/password registration and login backed by `bcryptjs` password hashing and `httpOnly` JWT session cookies.
- **Per-User Project Isolation**: Projects, uploaded CAD/map files, and thumbnails are stored behind authenticated Express routes (`/api/projects/:id/...`) with Helmet CSP, CORS, and API rate limiting — never exposed via unauthenticated static directories.
- **Persistent SQLite Storage (`data/arcsite.db`)**: WAL-mode SQLite schema storing `users`, `projects`, `assets`, `files`, and `activity_log`.

### 2. Interactive Site Map & Precision Polygon Zones
- **Smooth Pan & Zoom Map Viewport**: Mouse-drag panning, cursor-centered scroll-wheel zoom (`0.4x – 5x`), touch pinch-zoom, and instant `Fit` reset.
- **Zone Creation & Editing**:
  - **Manual Draw Zone (`P` / `D`)**: Click plot corners directly on the map with Undo (`U` / `Ctrl+Z`) and Finish (`Enter` / button).
  - **Vector PDF + In-Browser SlimSAM AI (`T`)**: Click inside any plot, room, courtyard, or roof to trace a multi-corner polygon cleanly (Tier 1 native vector PDF geometry first; Tier 2 in-browser `Xenova/slimsam-77-uniform` WebGPU/WASM segmentation fallback for raster/aerial maps).
  - **Specific Asset Alignment (`Align Shape` / `A` / `S`)**: Select any existing asset from the map popup or editor and click directly inside its true boundary on the map (or auto-align to current/detected coordinates) without creating duplicates.
  - **Direct Vertex Refinement**: In **Edit Mode (`E`)**, drag individual polygon corner handles, click a polygon edge to insert a corner, right-click a corner to remove it, or nudge the zone using the Arrow keys.
  - **Multi-Entry Deletion**: Delete assets directly from the map hotspot badge (`×`), popup footer, sidebar, editor panel, or `Delete`/`Backspace` shortcut.

### 3. Smart Assist (CAD / PDF Plan Analysis)
- Extracts embedded vector labels, area tags (`SQM`, `SQFT`, `Acres`, `Hectares`), and zone classifications (`building`, `landscape`, `utility`, `transit`, `road`, `civic`) from uploaded CAD-exported PDFs.
- **Tier 1 Vector PDF Engine (`smart-assist.js`)**:
  - Parses PDF `getOperatorList()` closed paths (`moveTo/lineTo/closePath`, `rectangle`), discards `clip/endPath` framing boxes, collapses thin AutoCAD stroke strips into centerlines, separates gray CAD hatch strokes, clusters endpoints (`0.6%`), splits crossing/T-junction intersections, prunes degree-1 dimension stubs, and extracts tight planar CCW polygon faces around labels.
  - **Align All Shapes (`#sa-resnap-btn`)**: Re-aligns existing map zones against extracted PDF vectors or SlimSAM AI.
  - Automatically matches and links related project files (`Architecture`, `Structural`, `MEP`, `Site Plan`, `Views & 3D`, `Working CAD`, `References`, `General`) to generated zones.

### 4. Multi-Format CAD, BIM, 3D & Presentation Viewer
- **Site Folder & File Import**: Drag-and-drop file uploads and whole-folder architecture import (`Import Folder`) with client-side PDF cover thumbnailing and server-side thumbnail generation (`sharp` / embedded preview extraction).
- **In-Browser Viewers (`viewers.js`)**:
  - **PDF**: Multi-page zoomed rendering via `pdf.js`.
  - **2D CAD (`.dxf`)**: Layer toggles and interactive canvas panning/zooming.
  - **3D Models (`.glb`, `.gltf`, `.obj`, `.stl`)**: Three.js OrbitControls 3D inspection.
  - **BIM (`.ifc`)**: Three.js + `web-ifc` geometry viewer and element metadata inspector.
  - **Images & Multi-Page TIFF**: Native viewer and `utif` decoding.
  - **Proprietary CAD/BIM & Decks (`.dwg`, `.bak`, `.skp`, `.skb`, `.rvt`, `.rfa`, `.pptx`)**: Extracts binary header versions, layer/component metadata, slide snippets, and embedded previews cleanly.

### 5. Client Presentation, Reporting & Themes
- **Area Schedule & Approval Audit (`K`)**: Summarizes zones, SQM/area figures, WIP / Review / Approved status breakdown, document coverage, and project activity log.
- **Visual Gallery (`G`)**: Dedicated lightbox gallery for site renders, aerials, and 3D assets.
- **Presentation Mode**: Hides authoring panels/edit handles for executive client walkthroughs while keeping interactive zones, popups, Schedule, and Gallery accessible.
- **Three Architectural Themes (`1` / `2` / `3`)**: **Studio**, **Blueprint**, and **CAD Darkroom**.
- **CAD Keyboard Shortcuts (`?` / `Keys ?`)**: Built-in shortcut reference sheet (`V`, `E`, `P`/`D`, `T`, `A`, `S`, `N`, `L`, `M`, `K`, `G`, `F`/`0`, `+/-`, `[`/`]`, `Arrows`, `Del`, `1/2/3`, `?`).

---

## Project Structure

```text
interactive-site-navigator/
├── server.js                      # Express entry point, Helmet CSP, static no-cache headers, API routing
├── package.json
├── .gitignore
├── src/
│   ├── db/
│   │   └── database.js            # SQLite schema & initialization (users, projects, assets, files, activity_log)
│   ├── middleware/
│   │   ├── auth.js                # JWT cookie signing & requireAuth middleware
│   │   └── security.js            # Rate limiters, filename sanitizer, security middleware
│   ├── routes/
│   │   ├── auth.js                # /api/auth/* endpoints
│   │   ├── projects.js            # /api/projects/* CRUD, map upload/stream, labels, activity, export
│   │   ├── assets.js              # /api/projects/:id/assets/* CRUD, batch create, reorder
│   │   └── files.js               # /api/projects/:id/files/* upload, metadata, thumbnail, download
│   └── services/
│       └── fileProcessor.js       # Image/CAD/BIM/PPTX metadata & embedded thumbnail extractor
└── public/
    ├── index.html                 # SPA layout (Auth, Dashboard, Project Map Workspace, Modals)
    ├── css/
    │   └── main.css               # Studio, Blueprint, and CAD Dark theme system & workspace UI
    ├── assets/
    │   └── site-map.svg           # Fallback sample site plan map
    └── js/
        ├── app.js                 # Router, API helper, theme switcher, modal/confirm & toast utilities
        ├── auth.js                # Login & registration controller
        ├── dashboard.js           # Multi-project dashboard controller
        ├── map.js                 # Zoom/pan viewport controller
        ├── project.js             # Project workspace, zones, editing, shortcuts & panels controller
        ├── smart-assist.js        # PDF label/area extractor, planar vector graph & mask vectorizer
        ├── slimsam-segmenter.js   # On-demand in-browser SlimSAM WebGPU/WASM image segmentation
        └── viewers.js             # Multi-format PDF, DXF, IFC, 3D, image & document viewer
```

---

## Quick Start

### Prerequisites
- **Node.js 18+** (with native build toolchain if rebuilding `better-sqlite3` / `sharp` on your platform)

### Run Locally
```bash
npm install
npm start
```

Open **`http://localhost:3000`** in Chrome/Edge (WebGPU-capable browser recommended for **SlimSAM AI** on raster/aerial maps).

Optional environment variables:
- `PORT` — HTTP port (defaults to `3000`)
- `JWT_SECRET` — Secret key for signing auth cookies (auto-generated fallback used if unset for local dev)

---

## API Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Create account & set session cookie |
| `POST` | `/api/auth/login` | Authenticate & set session cookie |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `GET` | `/api/auth/me` | Return current authenticated user |
| `GET` / `POST` | `/api/projects` | List or create user projects |
| `GET` / `PUT` / `DELETE` | `/api/projects/:id` | Read, update, or delete a project & its uploads |
| `POST` / `GET` | `/api/projects/:id/upload-map`, `/map` | Upload or stream protected project site-plan image |
| `PUT` | `/api/projects/:id/detected-labels` | Save extracted Smart Assist PDF labels |
| `GET` | `/api/projects/:id/activity` | Retrieve recent project activity log |
| `GET` | `/api/projects/:id/export` | Export project JSON backup |
| `GET` / `POST` | `/api/projects/:id/assets` | List or create zone/hotspot asset |
| `POST` | `/api/projects/:id/assets/batch` | Batch-create Smart Assist zones & attach matched files |
| `PUT` | `/api/projects/:id/assets/reorder` | Update asset display ordering |
| `PUT` / `DELETE` | `/api/projects/:id/assets/:assetId` | Update asset shape/polygon/fields or remove zone |
| `GET` / `POST` | `/api/projects/:id/files`, `/files/upload` | List or multi-upload project files |
| `GET` / `PATCH` / `DELETE` | `/api/projects/:id/files/:fileId` | Inspect, assign/update status, or delete file |
| `GET` | `/api/projects/:id/files/:fileId/thumbnail`, `/download` | Stream file thumbnail or download/inline content |
