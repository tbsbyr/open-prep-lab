import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import {
  BookOpen,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Download,
  FlipHorizontal,
  History,
  KeyRound,
  RotateCcw,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sampleBook } from "./data/sampleBook";
import {
  allRatings,
  allSpeeds,
  fetchCloudEval,
  fetchExplorer,
  fetchMoveEval,
  hasToken,
  LichessApiError,
  setToken,
  type CloudEval,
  type ExplorerData,
  type ExplorerSource,
  type LichessFilters,
  type LichessSpeed,
  type MoveEval,
} from "./lib/lichess";
import {
  buildImportedDatabase,
  buildSampleDatabase,
  mergeCandidates,
  parseFen,
  startFen,
  type OpeningDatabase,
} from "./lib/opening";

type Orientation = "white" | "black";
type DbSource = ExplorerSource | "pgn";
type LineEntry = { san: string; uci: string; fen: string };

type Row = {
  uci: string;
  san: string;
  games: number;
  shareOfTotal: number;
  whitePct: number;
  drawPct: number;
  blackPct: number;
  score: number;
};

type ExplorerState =
  | { status: "idle" | "loading" }
  | { status: "ok"; data: ExplorerData }
  | { status: "error"; message: string };

type EvalState =
  | { status: "idle" | "loading" }
  | { status: "ok"; data: CloudEval | null }
  | { status: "error"; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleDatabase = buildSampleDatabase(sampleBook);
const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const pieces: Record<Color, Record<PieceSymbol, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const sourceLabels: Record<DbSource, string> = {
  masters: "Masters",
  lichess: "Lichess",
  pgn: "My PGN",
};

function loadFilters(): LichessFilters {
  try {
    const stored = localStorage.getItem("open-prep-lab-filters");
    if (stored) return JSON.parse(stored);
  } catch {
    /* fall through to defaults */
  }
  return { speeds: ["blitz", "rapid", "classical"], ratings: [1600, 1800, 2000, 2200, 2500] };
}

function App() {
  const [rootFen, setRootFen] = useState(startFen());
  const [line, setLine] = useState<LineEntry[]>([]);
  const [ply, setPly] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("white");
  const [source, setSource] = useState<DbSource>("masters");
  const [filters, setFilters] = useState<LichessFilters>(loadFilters);
  const [importText, setImportText] = useState("");
  const [importedDatabase, setImportedDatabase] = useState<OpeningDatabase>(() => new Map());
  const [notice, setNotice] = useState("Pick a database, then click moves to build a line");
  const [explorer, setExplorer] = useState<ExplorerState>({ status: "idle" });
  const [cloud, setCloud] = useState<EvalState>({ status: "idle" });
  const [moveEvals, setMoveEvals] = useState<{ fen: string; map: Record<string, MoveEval | null> }>({
    fen: "",
    map: {},
  });
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenSaved, setTokenSaved] = useState(hasToken);
  const [tokenVersion, setTokenVersion] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const stored = localStorage.getItem("open-prep-lab-notes");
    return stored ? JSON.parse(stored) : {};
  });

  const fen = ply === 0 ? rootFen : line[ply - 1].fen;
  const chess = useMemo(() => new Chess(fen), [fen]);

  useEffect(() => {
    localStorage.setItem("open-prep-lab-notes", JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem("open-prep-lab-filters", JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (source === "pgn") return;
    const controller = new AbortController();
    setExplorer({ status: "loading" });
    const timer = setTimeout(() => {
      fetchExplorer(fen, source, filters, controller.signal)
        .then((data) => setExplorer({ status: "ok", data }))
        .catch((error: Error) => {
          if (controller.signal.aborted) return;
          setExplorer({ status: "error", message: error.message });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fen, source, filters, tokenVersion]);

  useEffect(() => {
    const controller = new AbortController();
    setCloud({ status: "loading" });
    const timer = setTimeout(() => {
      fetchCloudEval(fen, 5, controller.signal)
        .then((data) => setCloud({ status: "ok", data }))
        .catch((error: Error) => {
          if (controller.signal.aborted) return;
          setCloud({ status: "error", message: error.message });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fen, tokenVersion]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") setPly((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setPly((current) => Math.min(line.length, current + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [line.length]);

  const pgnRows = useMemo(() => {
    if (source !== "pgn") return [];
    return mergeCandidates(fen, sampleDatabase, importedDatabase)
      .filter((move) => move.source !== "generated")
      .map((move): Row => {
        const games = move.wins + move.draws + move.losses;
        const whiteWins = chess.turn() === "w" ? move.wins : move.losses;
        const blackWins = chess.turn() === "w" ? move.losses : move.wins;
        return {
          uci: move.uci,
          san: move.san,
          games: move.games,
          shareOfTotal: 0,
          whitePct: games ? (whiteWins / games) * 100 : 0,
          drawPct: games ? (move.draws / games) * 100 : 0,
          blackPct: games ? (blackWins / games) * 100 : 0,
          score: games ? Math.round(((move.wins + move.draws / 2) / games) * 100) : 0,
        };
      });
  }, [source, fen, importedDatabase, chess]);

  const rows = useMemo(() => {
    if (source === "pgn") {
      const total = pgnRows.reduce((sum, row) => sum + row.games, 0);
      return pgnRows.map((row) => ({ ...row, shareOfTotal: total ? (row.games / total) * 100 : 0 }));
    }
    if (explorer.status !== "ok") return [];
    const { data } = explorer;
    const total = data.white + data.draws + data.black;
    return data.moves.map((move): Row => {
      const games = move.white + move.draws + move.black;
      const sideWins = chess.turn() === "w" ? move.white : move.black;
      return {
        uci: move.uci,
        san: move.san,
        games,
        shareOfTotal: total ? (games / total) * 100 : 0,
        whitePct: games ? (move.white / games) * 100 : 0,
        drawPct: games ? (move.draws / games) * 100 : 0,
        blackPct: games ? (move.black / games) * 100 : 0,
        score: games ? Math.round(((sideWins + move.draws / 2) / games) * 100) : 0,
      };
    });
  }, [source, explorer, pgnRows, chess]);

  const rowsKey = rows.map((row) => row.uci).join(",");
  const whiteToMove = chess.turn() === "w";

  // The multi-PV cloud request already returns the engine's top moves with
  // their deep evals, so annotate those candidate moves for free.
  const baseEvalMap = useMemo<Record<string, MoveEval>>(() => {
    const map: Record<string, MoveEval> = {};
    if (cloud.status === "ok" && cloud.data) {
      for (const pv of cloud.data.pvs) {
        if (pv.firstUci) map[pv.firstUci] = { cp: pv.cp, mate: pv.mate, depth: cloud.data.depth };
      }
    }
    return map;
  }, [cloud]);

  // Once the position is settled, gently backfill deep evals for the remaining
  // visible moves (those the engine didn't rank in its top lines). It only
  // starts after a pause, runs one request at a time with a gap, and stops on
  // the first rate-limit response — so fast browsing only ever costs the single
  // multi-PV request above.
  useEffect(() => {
    if (cloud.status !== "ok" || !cloud.data) return;
    const covered = new Set(cloud.data.pvs.map((pv) => pv.firstUci));
    const targets = rows
      .slice(0, 14)
      .filter((row) => !covered.has(row.uci))
      .slice(0, 8);
    if (targets.length === 0) return;

    const controller = new AbortController();
    let active = true;
    const map: Record<string, MoveEval | null> = {};

    const timer = setTimeout(async () => {
      for (const row of targets) {
        if (!active || controller.signal.aborted) return;
        const probe = new Chess(fen);
        try {
          probe.move({
            from: row.uci.slice(0, 2) as Square,
            to: row.uci.slice(2, 4) as Square,
            promotion: (row.uci[4] as "q" | "r" | "b" | "n" | undefined) ?? "q",
          });
        } catch {
          continue;
        }
        try {
          map[row.uci] = await fetchMoveEval(probe.fen(), controller.signal);
        } catch (error) {
          if (error instanceof LichessApiError && error.status === 429) return;
          map[row.uci] = null;
        }
        if (active) setMoveEvals({ fen, map: { ...map } });
        await sleep(300);
      }
    }, 700);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, rowsKey, fen]);

  const currentEvals: Record<string, MoveEval | null> = {
    ...(moveEvals.fen === fen ? moveEvals.map : {}),
    ...baseEvalMap,
  };
  const evalsLoading = cloud.status === "loading" || cloud.status === "idle";
  const moverBestUci = cloud.status === "ok" ? cloud.data?.pvs[0]?.firstUci ?? null : null;

  const totalGames =
    source !== "pgn" && explorer.status === "ok"
      ? explorer.data.white + explorer.data.draws + explorer.data.black
      : rows.reduce((sum, row) => sum + row.games, 0);
  const opening = source !== "pgn" && explorer.status === "ok" ? explorer.data.opening : null;
  const bestPv = cloud.status === "ok" ? cloud.data?.pvs[0] : undefined;
  const whiteEvalPct = evalToWhitePct(bestPv);
  const moveNumberBase = Number(rootFen.split(" ")[5] ?? "1");
  const rootIsBlackToMove = rootFen.split(" ")[1] === "b";

  function playUci(uci: string) {
    const next = new Chess(fen);
    let played;
    try {
      played = next.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] ?? "q" });
    } catch {
      return;
    }
    const entry: LineEntry = { san: played.san, uci, fen: next.fen() };
    setLine((current) => [...current.slice(0, ply), entry]);
    setPly(ply + 1);
    setSelected(null);
  }

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(chess.moves({ square: selected, verbose: true }).map((move) => move.to));
  }, [chess, selected]);

  function onSquare(square: Square) {
    if (selected && legalTargets.has(square)) {
      playUci(`${selected}${square}`);
      return;
    }
    const piece = chess.get(square);
    setSelected(piece?.color === chess.turn() ? square : null);
  }

  function importStudy() {
    const asFen = parseFen(importText);
    if (asFen) {
      setRootFen(asFen);
      setLine([]);
      setPly(0);
      setNotice("FEN loaded as new root position");
      return;
    }
    if (!importText.trim()) {
      setNotice("Paste a FEN or one or more PGN games first");
      return;
    }
    const imported = buildImportedDatabase(importText);
    setImportedDatabase(imported);
    setSource("pgn");
    setNotice(`Aggregated ${countImportedGames(imported).toLocaleString()} move observations from your PGN`);
  }

  function exportStudy() {
    const payload = {
      name: "Open Prep Lab study",
      rootFen,
      fen,
      line: line.map((entry) => entry.san),
      source,
      filters: source === "lichess" ? filters : undefined,
      opening,
      note: notes[fen] ?? "",
      explorerMoves: rows,
      cloudEval: cloud.status === "ok" ? cloud.data : null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "open-prep-lab-study.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setRootFen(startFen());
    setLine([]);
    setPly(0);
    setSelected(null);
    setNotice("Reset to start position");
  }

  function saveToken() {
    setToken(tokenDraft);
    setTokenSaved(tokenDraft.trim().length > 0);
    setTokenDraft("");
    setTokenVersion((version) => version + 1);
    setNotice(tokenDraft.trim() ? "Lichess token saved locally" : "Lichess token cleared");
  }

  function toggleSpeed(speed: LichessSpeed) {
    setFilters((current) => ({
      ...current,
      speeds: current.speeds.includes(speed)
        ? current.speeds.filter((item) => item !== speed)
        : [...current.speeds, speed],
    }));
  }

  function toggleRating(rating: number) {
    setFilters((current) => ({
      ...current,
      ratings: current.ratings.includes(rating)
        ? current.ratings.filter((item) => item !== rating)
        : [...current.ratings, rating],
    }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={21} />
          </div>
          <div>
            <h1>Open Prep Lab</h1>
            <p>Opening prep on top of the Lichess masters + community databases</p>
          </div>
        </div>
        <div className="toolbar" aria-label="Workspace controls">
          <button type="button" title="Flip board" onClick={() => setOrientation(orientation === "white" ? "black" : "white")}>
            <FlipHorizontal size={17} />
          </button>
          <button type="button" title="Reset to start position" onClick={reset}>
            <RotateCcw size={17} />
          </button>
          <button type="button" title="Export study as JSON" onClick={exportStudy}>
            <Download size={17} />
          </button>
        </div>
      </header>

      <section className="workspace" aria-label="Opening preparation workspace">
        <aside className="panel explorer-panel">
          <div className="panel-title">
            <div>
              <span>Explorer</span>
              <strong>{totalGames ? `${compactNumber(totalGames)} games` : "No data"}</strong>
            </div>
            <Search size={17} />
          </div>

          <div className="source-tabs" role="tablist" aria-label="Database source">
            {(Object.keys(sourceLabels) as DbSource[]).map((key) => (
              <button
                aria-selected={source === key}
                className={source === key ? "active" : ""}
                key={key}
                role="tab"
                type="button"
                onClick={() => setSource(key)}
              >
                {sourceLabels[key]}
              </button>
            ))}
          </div>

          {source === "lichess" ? (
            <div className="filter-block">
              <div className="chip-row" aria-label="Time controls">
                {allSpeeds.map((speed) => (
                  <button
                    className={`chip ${filters.speeds.includes(speed) ? "on" : ""}`}
                    key={speed}
                    type="button"
                    onClick={() => toggleSpeed(speed)}
                  >
                    {speed}
                  </button>
                ))}
              </div>
              <div className="chip-row" aria-label="Rating bands">
                {allRatings.map((rating) => (
                  <button
                    className={`chip ${filters.ratings.includes(rating) ? "on" : ""}`}
                    key={rating}
                    type="button"
                    onClick={() => toggleRating(rating)}
                  >
                    {rating}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="candidate-list" aria-label="Candidate moves">
            <div className="candidate-head">
              <span>Move</span>
              <span>Games</span>
              <span>Results</span>
              <span className="head-eval" title="Lichess cloud engine eval, from the mover's side">
                Eval
              </span>
            </div>
            {source !== "pgn" && explorer.status === "loading" ? <p className="list-note">Querying database…</p> : null}
            {source !== "pgn" && explorer.status === "error" ? (
              <p className="list-note error">{explorer.message}</p>
            ) : null}
            {rows.length === 0 &&
            (source === "pgn" || explorer.status === "ok") ? (
              <p className="list-note">
                {source === "pgn"
                  ? "No imported games reach this position. Paste PGNs below to build your own tree."
                  : "This position is out of book for the selected database."}
              </p>
            ) : null}
            {rows.map((row) => (
              <button className="candidate-row" key={row.uci} type="button" onClick={() => playUci(row.uci)}>
                <span
                  className={`move-name ${row.uci === moverBestUci ? "best" : ""}`}
                  title={row.uci === moverBestUci ? "Engine's top choice here" : undefined}
                >
                  {row.san}
                </span>
                <span className="move-meta">
                  <strong>{compactNumber(row.games)}</strong>
                  <small>
                    {row.shareOfTotal >= 0.5 ? `${Math.round(row.shareOfTotal)}% played` : "rare"} · {row.score}%
                  </small>
                </span>
                <span
                  className="wdl"
                  title={`White ${Math.round(row.whitePct)}% · Draw ${Math.round(row.drawPct)}% · Black ${Math.round(row.blackPct)}%`}
                >
                  <i style={{ width: `${row.whitePct}%` }} />
                  <b style={{ width: `${row.drawPct}%` }} />
                  <em style={{ width: `${row.blackPct}%` }} />
                </span>
                <MoveEvalCell ev={currentEvals[row.uci]} pending={evalsLoading} whiteToMove={whiteToMove} />
              </button>
            ))}
          </div>

          <details className="drawer">
            <summary>
              <Upload size={15} /> PGN / FEN import
            </summary>
            <textarea
              aria-label="PGN or FEN import"
              placeholder={"Paste a FEN to set the position, or PGN games to build the My PGN tree"}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <button className="import-button" type="button" onClick={importStudy}>
              Load data
            </button>
          </details>

          <details className="drawer">
            <summary>
              <KeyRound size={15} /> Lichess API token {tokenSaved ? "· saved" : "· optional"}
            </summary>
            <p className="drawer-note">
              If the explorer answers 401, create a personal token at lichess.org/account/oauth/token (no scopes
              needed) and paste it here. It is stored only in this browser.
            </p>
            <input
              aria-label="Lichess API token"
              placeholder="lip_..."
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            <button className="import-button" type="button" onClick={saveToken}>
              {tokenDraft.trim() ? "Save token" : "Clear token"}
            </button>
          </details>
        </aside>

        <section className="board-column">
          <div className="status-line">
            <span className="opening-name">
              {opening ? `${opening.eco} ${opening.name}` : notice}
            </span>
            <span>{chess.turn() === "w" ? "White" : "Black"} to move</span>
          </div>
          <ChessBoard
            arrows={rows.slice(0, 3)}
            chess={chess}
            legalTargets={legalTargets}
            onSquare={onSquare}
            orientation={orientation}
            selected={selected}
          />
          <div className="nav-row">
            <button disabled={ply === 0} title="Start of line" type="button" onClick={() => setPly(0)}>
              <ChevronFirst size={17} />
            </button>
            <button disabled={ply === 0} title="Back one move (←)" type="button" onClick={() => setPly(ply - 1)}>
              <ChevronLeft size={17} />
            </button>
            <button
              disabled={ply === line.length}
              title="Forward one move (→)"
              type="button"
              onClick={() => setPly(ply + 1)}
            >
              <ChevronRight size={17} />
            </button>
            <button
              disabled={ply === line.length}
              title="End of line"
              type="button"
              onClick={() => setPly(line.length)}
            >
              <ChevronLast size={17} />
            </button>
            <div className="line-strip" aria-label="Move list">
              <History size={15} />
              {line.length === 0 ? <span className="line-placeholder">Play or click a move to build a line</span> : null}
              {line.map((entry, index) => {
                const moveIndex = index + (rootIsBlackToMove ? 1 : 0);
                const number = moveNumberBase + Math.floor(moveIndex / 2);
                const label = moveIndex % 2 === 0 ? `${number}.${entry.san}` : entry.san;
                return (
                  <button
                    className={`line-move ${index + 1 === ply ? "current" : ""}`}
                    key={`${index}-${entry.uci}`}
                    type="button"
                    onClick={() => setPly(index + 1)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="panel analysis-panel">
          <div className="panel-title">
            <div>
              <span>Deep Lines · Lichess cloud</span>
              <strong>{bestPv ? formatPvEval(bestPv) : "—"}</strong>
            </div>
            <Star size={17} />
          </div>

          <div className="eval-strip" aria-label="Evaluation bar" title="White's share of the evaluation">
            <span style={{ width: `${whiteEvalPct}%` }} />
          </div>

          <section className="analysis-section">
            {cloud.status === "loading" ? <p>Fetching cloud evaluation…</p> : null}
            {cloud.status === "error" ? <p className="error">{cloud.message}</p> : null}
            {cloud.status === "ok" && !cloud.data ? (
              <p>
                This position is not in the Lichess cloud database yet — you are past the deeply analyzed zone.
                Trust your notes and the database stats.
              </p>
            ) : null}
            {cloud.status === "ok" && cloud.data ? (
              <ol className="pv-list">
                {cloud.data.pvs.map((pv, index) => (
                  <li key={index}>
                    <button
                      className="pv-play"
                      title="Play the first move of this line"
                      type="button"
                      onClick={() => {
                        try {
                          const move = new Chess(fen).move(pv.sanLine[0]);
                          playUci(`${move.from}${move.to}${move.promotion ?? ""}`);
                        } catch {
                          /* stale PV for a different position */
                        }
                      }}
                    >
                      {formatPvEval(pv)}
                    </button>
                    <span className="pv">{formatSanLine(pv.sanLine, fen)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          <section className="analysis-grid">
            <Metric label="Depth" value={cloud.status === "ok" && cloud.data ? `${cloud.data.depth} ply` : "—"} />
            <Metric
              label="Nodes"
              value={cloud.status === "ok" && cloud.data ? `${compactNumber(cloud.data.knodes * 1000)}` : "—"}
            />
            <Metric label="Database" value={sourceLabels[source]} />
            <Metric label="Games here" value={compactNumber(totalGames)} />
          </section>

          <section className="analysis-section">
            <h3>Position Note</h3>
            <textarea
              aria-label="Position note"
              placeholder="Add repertoire note, model game, or practical warning..."
              value={notes[fen] ?? ""}
              onChange={(event) => setNotes((current) => ({ ...current, [fen]: event.target.value }))}
            />
          </section>
        </aside>
      </section>
    </main>
  );
}

function ChessBoard({
  arrows,
  chess,
  legalTargets,
  onSquare,
  orientation,
  selected,
}: {
  arrows: Row[];
  chess: Chess;
  legalTargets: Set<string>;
  onSquare: (square: Square) => void;
  orientation: Orientation;
  selected: Square | null;
}) {
  const boardSquares = getSquares(orientation);

  return (
    <div className="board-wrap">
      <svg className="arrow-layer" viewBox="0 0 800 800" aria-hidden="true">
        <defs>
          <marker id="arrow-head" markerHeight="7" markerWidth="7" orient="auto" refX="4.4" refY="3">
            <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
          </marker>
        </defs>
        {arrows.map((move, index) => {
          const from = squareCenter(move.uci.slice(0, 2), orientation);
          const to = squareCenter(move.uci.slice(2, 4), orientation);
          return (
            <line
              className={`move-arrow arrow-${index}`}
              key={move.uci}
              markerEnd="url(#arrow-head)"
              x1={from.x}
              x2={to.x}
              y1={from.y}
              y2={to.y}
            />
          );
        })}
      </svg>
      <div className="board">
        {boardSquares.map((square) => {
          const piece = chess.get(square);
          const isLight = (files.indexOf(square[0] as (typeof files)[number]) + Number(square[1])) % 2 === 1;
          return (
            <button
              aria-label={square}
              className={[
                "square",
                isLight ? "light" : "dark",
                selected === square ? "selected" : "",
                legalTargets.has(square) ? "target" : "",
              ].join(" ")}
              key={square}
              type="button"
              onClick={() => onSquare(square)}
            >
              <span className={`piece ${piece?.color === "b" ? "black-piece" : ""}`}>
                {piece ? pieces[piece.color][piece.type] : ""}
              </span>
              {showFileLabel(square, orientation) ? <small className="file-label">{square[0]}</small> : null}
              {showRankLabel(square, orientation) ? <small className="rank-label">{square[1]}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MoveEvalCell({
  ev,
  pending,
  whiteToMove,
}: {
  ev: MoveEval | null | undefined;
  pending: boolean;
  whiteToMove: boolean;
}) {
  if (ev) {
    const relative = moverEval(ev, whiteToMove);
    const score = moverScore(relative);
    const tone = score > 35 ? "up" : score < -35 ? "down" : "level";
    return (
      <span className={`mv-eval ${tone}`} title={`Lichess cloud eval · depth ${ev.depth}`}>
        {formatMoverEval(relative)}
      </span>
    );
  }
  if (pending) {
    return (
      <span className="mv-eval pending" title="Fetching Lichess cloud eval…">
        ···
      </span>
    );
  }
  return (
    <span className="mv-eval none" title="Not among the engine's top lines here">
      –
    </span>
  );
}

function moverEval(ev: MoveEval, whiteToMove: boolean): { cp?: number; mate?: number } {
  const sign = whiteToMove ? 1 : -1;
  if (ev.mate !== undefined) return { mate: ev.mate * sign };
  return { cp: (ev.cp ?? 0) * sign };
}

function moverScore(value: { cp?: number; mate?: number }) {
  if (value.mate !== undefined) return value.mate > 0 ? 1_000_000 - value.mate : -1_000_000 - value.mate;
  return value.cp ?? 0;
}

function formatMoverEval(value: { cp?: number; mate?: number }) {
  if (value.mate !== undefined) return `${value.mate > 0 ? "#" : "#-"}${Math.abs(value.mate)}`;
  const pawns = (value.cp ?? 0) / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getSquares(orientation: Orientation) {
  const orderedRanks = orientation === "white" ? [...ranks].reverse() : [...ranks];
  const orderedFiles = orientation === "white" ? [...files] : [...files].reverse();
  return orderedRanks.flatMap((rank) => orderedFiles.map((file) => `${file}${rank}` as Square));
}

function squareCenter(square: string, orientation: Orientation) {
  const fileIndex = files.indexOf(square[0] as (typeof files)[number]);
  const rankIndex = ranks.indexOf(square[1] as (typeof ranks)[number]);
  const x = orientation === "white" ? fileIndex * 100 + 50 : (7 - fileIndex) * 100 + 50;
  const y = orientation === "white" ? (7 - rankIndex) * 100 + 50 : rankIndex * 100 + 50;
  return { x, y };
}

function showFileLabel(square: string, orientation: Orientation) {
  return orientation === "white" ? square[1] === "1" : square[1] === "8";
}

function showRankLabel(square: string, orientation: Orientation) {
  return orientation === "white" ? square[0] === "a" : square[0] === "h";
}

function compactNumber(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
}

function formatPvEval(pv: { cp?: number; mate?: number }) {
  if (pv.mate !== undefined) return `#${pv.mate}`;
  const value = (pv.cp ?? 0) / 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function evalToWhitePct(pv: { cp?: number; mate?: number } | undefined) {
  if (!pv) return 50;
  if (pv.mate !== undefined) return pv.mate > 0 ? 98 : 2;
  const cp = pv.cp ?? 0;
  return Math.round(50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1));
}

function formatSanLine(sanLine: string[], fen: string) {
  const startsWithBlack = fen.split(" ")[1] === "b";
  const baseNumber = Number(fen.split(" ")[5] ?? "1");
  const parts: string[] = [];
  sanLine.forEach((san, index) => {
    const moveIndex = index + (startsWithBlack ? 1 : 0);
    const number = baseNumber + Math.floor(moveIndex / 2);
    if (moveIndex % 2 === 0) {
      parts.push(`${number}.${san}`);
    } else if (index === 0) {
      parts.push(`${number}...${san}`);
    } else {
      parts.push(san);
    }
  });
  return parts.join(" ");
}

function countImportedGames(database: OpeningDatabase) {
  let count = 0;
  for (const moves of database.values()) {
    count += moves.reduce((sum, move) => sum + move.games, 0);
  }
  return count;
}

export default App;
