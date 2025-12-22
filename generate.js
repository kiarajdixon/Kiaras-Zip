// generate.js
// Appends NEW puzzles into puzzles.json (does NOT overwrite).
// Prevents duplicates by:
//   1) identical grid
//   2) identical solver path
//
// Key fixes already included:
// - grid is stored as a real 2D array (valid for your site).
// - solutionPath stored as a compact string "r,c;r,c;..." to keep file readable.
// - heartbeat + give-up logic + ALWAYS saves progress.
// - writeOut() is defined once (not inside a loop).
//
// New (Option B):
// - DFS solver now includes pruning for:
//   (1) Reachability to the next required number via BFS over *currently-walkable* cells
//   (2) Connectivity (no disconnected islands) of currently-walkable unvisited cells
//
// This keeps correctness for small boards and makes large boards much less hopeless.

const fs = require("fs");
const path = require("path");

// --------------------------
// CLI args
// --------------------------
function parseArgs(argv) {
  const out = { count: 30, sizes: [4, 6], outFile: "puzzles.json" };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count") out.count = Number(argv[++i]);
    else if (a === "--sizes") {
      out.sizes = String(argv[++i])
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 2);
    } else if (a === "--out") out.outFile = String(argv[++i]);
  }

  if (!Number.isFinite(out.count) || out.count <= 0) out.count = 30;
  if (!Array.isArray(out.sizes) || out.sizes.length === 0) out.sizes = [4, 6];

  return out;
}

const ARGS = parseArgs(process.argv);

// --------------------------
// Helpers
// --------------------------
function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeEmptyGrid(n) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

function allCells(n) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push([r, c]);
  return out;
}

function neighbors4(n, r, c) {
  const out = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < n - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < n - 1) out.push([r, c + 1]);
  return out;
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    console.warn(`Warning: could not read/parse ${filePath}. Starting fresh.`);
    return null;
  }
}

// --------------------------
// Compact path format
// --------------------------
function solutionPathToString(pathArr) {
  // "r,c;r,c;..."
  return pathArr.map(([r, c]) => `${r},${c}`).join(";");
}

function stringToSolutionPath(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  const parts = s.split(";");
  const out = [];
  for (const p of parts) {
    const [rs, cs] = p.split(",");
    const r = Number(rs);
    const c = Number(cs);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
    out.push([r, c]);
  }
  return out;
}

// If you have old data where grid was stored as a pretty string, we can still read it:
function prettyStringToGrid(s) {
  // Extracts rows like "[0, 4, 0, 0]" from the string
  const rowMatches = typeof s === "string" ? s.match(/\[[^\[\]]+\]/g) : null;
  if (!rowMatches) return null;

  const rows = rowMatches.map((rowStr) =>
    rowStr
      .replace(/[\[\]]/g, "")
      .split(",")
      .map((x) => Number(x.trim()))
  );

  const n = rows[0]?.length;
  if (!n || rows.some((r) => r.length !== n)) return null;
  return rows;
}

function gridKey(grid) {
  return grid.map((row) => row.join(",")).join(";");
}
function puzzleGridKey(n, grid) {
  return `${n}|${gridKey(grid)}`;
}
function puzzleSolutionKey(n, solutionPathArr) {
  return `${n}|${solutionPathToString(solutionPathArr)}`;
}

function writeOut(outPath, puzzles) {
  // Pretty output, but grid stays a valid 2D array.
  // solutionPath is a string, so it stays compact.
  fs.writeFileSync(outPath, JSON.stringify({ zips: puzzles }, null, 2), "utf8");
}

// --------------------------
// DFS solver for Zip puzzle
// Rules:
// - start at 1
// - cover every cell exactly once
// - orthogonal moves only
// - numbered checkpoints 1..K visited in order
// - cannot step on a numbered cell unless it is the next required number
// - end on K
//
// Upgrades (Option B):
// - BFS reachability prune to next checkpoint
// - "No disconnected islands" prune over currently-walkable unvisited cells
// --------------------------
function solveZipDFS(grid) {
  const n = grid.length;
  const N = n * n;

  // Collect required numbers; must be exactly 1..K (no gaps)
  const req = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (grid[r][c] !== 0) req.push(grid[r][c]);
  req.sort((a, b) => a - b);

  if (req.length === 0 || req[0] !== 1) return null;
  for (let i = 0; i < req.length; i++) if (req[i] !== i + 1) return null;
  const K = req.length;

  // Map value -> position for O(1) lookup
  const posOf = Array(K + 1).fill(null);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = grid[r][c];
      if (v !== 0) {
        if (v >= 1 && v <= K) posOf[v] = [r, c];
        else return null; // safety: value outside 1..K (shouldn't happen in your generator)
      }
    }
  }

  const start = posOf[1];
  if (!start) return null;

  const visited = Array.from({ length: n }, () => Array(n).fill(false));
  const path = [];

  visited[start[0]][start[1]] = true;
  path.push(start);

  // ------------ rule helpers ------------
  function isForbiddenCell(r, c, needed) {
    const v = grid[r][c];
    // If it's numbered and not the next required number, it is forbidden *right now*
    return v !== 0 && needed !== null && v !== needed;
  }

  function canStandOn(r, c, needed) {
    if (visited[r][c]) return false;
    return !isForbiddenCell(r, c, needed);
  }

  function degreeOfCell(r, c, needed) {
    let d = 0;
    for (const [nr, nc] of neighbors4(n, r, c)) {
      if (canStandOn(nr, nc, needed)) d++;
    }
    return d;
  }

  // BFS reachability: can we reach the next required number using only currently-walkable cells?
  function reachableToNeeded(curR, curC, needed) {
    if (needed === null) return true;

    const target = posOf[needed];
    if (!target) return false;
    const [tr, tc] = target;

    if (visited[tr][tc]) return true;
    if (isForbiddenCell(tr, tc, needed)) return false; // should never trigger, but safe

    const seen = Array.from({ length: n }, () => Array(n).fill(false));
    const q = new Array(n * n);
    let head = 0;
    let tail = 0;

    q[tail++] = [curR, curC];
    seen[curR][curC] = true;

    while (head < tail) {
      const [r, c] = q[head++];

      for (const [nr, nc] of neighbors4(n, r, c)) {
        if (seen[nr][nc]) continue;
        if (visited[nr][nc]) continue;
        if (isForbiddenCell(nr, nc, needed)) continue;

        if (nr === tr && nc === tc) return true;

        seen[nr][nc] = true;
        q[tail++] = [nr, nc];
      }
    }

    return false;
  }

  // Connectivity prune:
  // Treat "future numbers" as walls for the current phase (matches your movement rule).
  // If the currently-walkable unvisited cells are split into multiple components, it's impossible.
  function walkableUnvisitedConnected(needed) {
    let seed = null;
    let walkableCount = 0;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (visited[r][c]) continue;
        if (isForbiddenCell(r, c, needed)) continue;
        walkableCount++;
        if (!seed) seed = [r, c];
      }
    }

    if (walkableCount === 0) return true;

    const seen = Array.from({ length: n }, () => Array(n).fill(false));
    const q = new Array(n * n);
    let head = 0;
    let tail = 0;

    q[tail++] = seed;
    seen[seed[0]][seed[1]] = true;

    let reached = 0;

    while (head < tail) {
      const [r, c] = q[head++];
      reached++;

      for (const [nr, nc] of neighbors4(n, r, c)) {
        if (seen[nr][nc]) continue;
        if (visited[nr][nc]) continue;
        if (isForbiddenCell(nr, nc, needed)) continue;

        seen[nr][nc] = true;
        q[tail++] = [nr, nc];
      }
    }

    return reached === walkableCount;
  }

  // ------------ DFS ------------
  function dfs(r, c, nextReq) {
    if (path.length === N) {
      if (nextReq !== K + 1) return false;
      return grid[r][c] === K;
    }

    const needed = nextReq <= K ? nextReq : null;

    // Prune 1: next checkpoint must be reachable through currently-walkable cells
    if (!reachableToNeeded(r, c, needed)) return false;

    // Prune 2: cannot leave disconnected "islands" of currently-walkable unvisited cells
    if (!walkableUnvisitedConnected(needed)) return false;

    let cand = [];
    for (const [nr, nc] of neighbors4(n, r, c)) {
      if (!canStandOn(nr, nc, needed)) continue;
      cand.push([nr, nc]);
    }

    // Same heuristic, but now "degree" respects forbidden cells too
    cand.sort(
      (a, b) => degreeOfCell(a[0], a[1], needed) - degreeOfCell(b[0], b[1], needed)
    );

    for (const [nr, nc] of cand) {
      const v = grid[nr][nc];
      const newNextReq =
        v !== 0 && needed !== null && v === needed ? nextReq + 1 : nextReq;

      visited[nr][nc] = true;
      path.push([nr, nc]);

      if (dfs(nr, nc, newNextReq)) return true;

      path.pop();
      visited[nr][nc] = false;
    }

    return false;
  }

  return dfs(start[0], start[1], 2) ? path : null;
}

// --------------------------
// Puzzle generator
// Your K rule: K in [n, 2n + max(0, n-3)]
// --------------------------
function kRangeForN(n) {
  const lo = n;
  const hi = 2 * n + Math.max(0, n - 3);
  return { lo, hi };
}

function randomPuzzleGrid(n) {
  const { lo, hi } = kRangeForN(n);
  const K = randInt(lo, hi);

  const grid = makeEmptyGrid(n);
  const cells = allCells(n);
  shuffle(cells);

  for (let k = 1; k <= K; k++) {
    const [r, c] = cells[k - 1];
    grid[r][c] = k;
  }

  return grid;
}

function generateSolvablePuzzle(n, maxAttempts = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const grid = randomPuzzleGrid(n);
    const sol = solveZipDFS(grid);
    if (sol) return { grid, solutionPath: sol };
  }
  return null;
}

// --------------------------
// Main: append + avoid duplicates + never hangs
// --------------------------
function main() {
  const outPath = path.join(process.cwd(), ARGS.outFile);

  const existingJson = safeReadJson(outPath);
  const existing = Array.isArray(existingJson?.zips) ? existingJson.zips : [];

  const seenGrids = new Set();
  const seenSolutions = new Set();
  let nextId = 1;

  // Load existing into dedupe sets
  for (const p of existing) {
    if (!p) continue;

    let grid = null;
    if (Array.isArray(p.grid)) grid = p.grid;
    else if (typeof p.grid === "string") grid = prettyStringToGrid(p.grid); // backward compat
    if (!grid) continue;

    const n = grid.length;
    seenGrids.add(puzzleGridKey(n, grid));

    if (Number.isFinite(p.id)) nextId = Math.max(nextId, p.id + 1);

    let sol = null;
    if (Array.isArray(p.solutionPath)) sol = p.solutionPath;
    else if (typeof p.solutionPath === "string") sol = stringToSolutionPath(p.solutionPath);

    // If solution missing/invalid, recompute (now with pruning)
    if (!sol) sol = solveZipDFS(grid);

    if (sol) seenSolutions.add(puzzleSolutionKey(n, sol));
  }

  const puzzles = existing.slice();

  // Distribute count across sizes
  const sizes = ARGS.sizes.slice().sort((a, b) => a - b);
  const perSizeBase = Math.floor(ARGS.count / sizes.length);
  let remainder = ARGS.count - perSizeBase * sizes.length;

  const targets = new Map();
  for (const s of sizes) {
    const add = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    targets.set(s, perSizeBase + add);
  }

  console.log(`Generating ${ARGS.count} NEW puzzles across sizes: ${sizes.join(", ")}`);
  console.log(
    `Targets: ${Array.from(targets.entries())
      .map(([n, t]) => `${n}x${n}:${t}`)
      .join(" | ")}`
  );
  console.log(`Appending into: ${outPath}`);
  console.log(`Already in file: ${existing.length} puzzles`);

  const MAX_CONSECUTIVE_FAILS = 100;
  const HEARTBEAT_EVERY_FAILS = 10;

  for (const n of sizes) {
    const target = targets.get(n) || 0;

    let got = 0;
    let consecutiveFails = 0;
    let totalAttempts = 0;

    console.log(`  [${n}x${n}] target=${target}`);

    while (got < target) {
      totalAttempts++;

      const result = generateSolvablePuzzle(n, 2000);

      if (!result) {
        consecutiveFails++;
      } else {
        const gKey = puzzleGridKey(n, result.grid);
        const sKey = puzzleSolutionKey(n, result.solutionPath);

        if (seenGrids.has(gKey) || seenSolutions.has(sKey)) {
          consecutiveFails++;
        } else {
          // success
          seenGrids.add(gKey);
          seenSolutions.add(sKey);

          puzzles.push({
            id: nextId++,
            grid: result.grid, // ✅ valid 2D array
            solutionPath: solutionPathToString(result.solutionPath), // compact
          });

          got++;
          consecutiveFails = 0;

          console.log(`  [${n}x${n}] added ${got}/${target} (attempts=${totalAttempts})`);

          // Save after every success
          writeOut(outPath, puzzles);
        }
      }

      if (consecutiveFails > 0 && consecutiveFails % HEARTBEAT_EVERY_FAILS === 0) {
        console.log(
          `  [${n}x${n}] still searching... consecutiveFails=${consecutiveFails}/${MAX_CONSECUTIVE_FAILS} (got=${got}/${target}, attempts=${totalAttempts})`
        );
      }

      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        console.log(
          `  [${n}x${n}] moving on after ${consecutiveFails} consecutive failures (got=${got}/${target}, attempts=${totalAttempts})`
        );
        break;
      }
    }

    // Save after each size completes (or gives up)
    writeOut(outPath, puzzles);
  }

  console.log(`Done. Total puzzles now: ${puzzles.length}`);
}

main();

