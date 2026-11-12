# Interactive Site Plan & Digital Asset Navigator

Professional project-management platform for architecture and construction teams. Upload site plans, create interactive hotspots for buildings/assets, and organize all project documentation (Architecture, Structural, MEP) in one visual interface.

## What this contains
- `index.html` — main page with header, sidebar, map workspace, and editor panel
- `styles.css` — professional PM-platform styling (header, sidebar, categorized popups, edit mode)
- `app.js` — frontend logic: loads `data.json`, renders hotspots, handles search, edit mode, drag/resize, export
- `data.json` — data-driven hotspot definitions with building titles, coordinates, and categorized document links
- `assets/site-map.svg` — sample site plan (upload your own PNG/JPG via "Upload Map" button)
- `docs/*/` — comprehensive placeholder documents organized by asset and category (Architecture, Structural, MEP)

## Features
✅ **Visual Site Map** — Display your site plan as an interactive canvas  
✅ **Clickable Hotspots** — Click/hover any building to see categorized documents  
✅ **Organized Documents** — Expandable categories: Architecture, Structural, MEP  
✅ **Sidebar Asset List** — Search and filter assets, click to focus on map  
✅ **Upload Custom Maps** — Replace the sample map with your own site plan image  
✅ **Edit Mode** — Toggle edit mode to drag hotspots, resize with handles, and adjust positions visually  
✅ **Export JSON** — Download updated `data.json` with your edits  
✅ **Responsive Design** — Works on desktop and tablet (mobile-optimized sidebar auto-hides)

## How to run (Windows PowerShell)
Open PowerShell in the project folder and run a simple static server:

**Option A: Python 3** (recommended)
```powershell
cd /workspace/interactive-site-navigator
python -m http.server 8000
```

**Option B: Node.js http-server**
```powershell
npm install -g http-server
cd /workspace/interactive-site-navigator
http-server -p 8000
```

Then open a browser to **http://localhost:8000**

## How to use
1. **View the map** — Site plan loads with 7 sample assets (B1/B2 Office, Sewage, Temple, Admin Block, Metro Bridge, Hilly Road)
2. **Click an asset** — Popup shows categorized documents (Architecture, Structural, MEP). Click category headers to expand/collapse.
3. **Search assets** — Use the sidebar search box to filter by name
4. **Upload your map** — Click "Upload Map" in the header and select your PNG/JPG site plan
5. **Edit Mode** — Click "Edit Mode" to enable visual editing:
   - Drag hotspots to reposition
   - Drag the resize handle (bottom-right corner) to adjust size
   - Use arrow buttons or manual inputs in the editor panel
   - Click "Save" to apply manual edits
6. **Export JSON** — Click "Export JSON" to download your updated `data.json` file

## How to customize
### Add/edit buildings and documents
Open `data.json` and modify the `assets` array. Each asset has:
- `id` — unique identifier
- `title` — display name (shown in sidebar and popup)
- `x`, `y`, `w`, `h` — position and size (percent strings, e.g., `"52%"`)
- `categories` — object with `Architecture`, `Structural`, `MEP` arrays of links

Example:
```json
{
  "id": "new-building",
  "title": "New Office Building",
  "x": "30%",
  "y": "40%",
  "w": "15%",
  "h": "20%",
  "categories": {
    "Architecture": [
      { "label": "Floor Plan", "href": "docs/new-building/arch-floor.html" }
    ],
    "Structural": [
      { "label": "Foundation", "href": "docs/new-building/struct-foundation.html" }
    ],
    "MEP": [
      { "label": "Electrical", "href": "docs/new-building/mep-elec.html" }
    ]
  }
}
```

### Replace placeholder documents
The `docs/` folder contains simple HTML placeholders. Replace with real PDFs or HTML pages as needed. Update the `href` values in `data.json` to point to your files.

## Sample Data
The demo includes 7 assets based on a real site plan:
- **B1 - Office** (210.8 SQM) — 9 documents (3 Architecture, 3 Structural, 3 MEP)
- **B2 - Office** (6745.2M) — 9 documents
- **Sewage Treatment Plant** (1100 SQM) — 8 documents
- **Temple** (1247.5M) — 7 documents
- **Admin Block** — 6 documents
- **Metro Bridge** — 4 documents
- **Hilly Road** — 6 documents

Total: **49 placeholder documents** organized across 3 categories.

## Tech Stack
- **HTML5** — semantic structure
- **CSS3** — flexbox layout, responsive design
- **Vanilla JavaScript (ES6+)** — no frameworks, fetch API, drag/drop, file upload
- **JSON** — data-driven configuration

## Next Steps (optional enhancements)
- Add PDF preview in lightbox/iframe instead of navigation
- Implement undo/redo for edits
- Add multi-select and bulk edit
- Add server-side persistence (Node.js/Express endpoint to save JSON)
- Add user authentication and role-based access (view vs edit)
- Add zoom/pan controls for large maps
- Add touch/pointer events for mobile drag/resize

