import { Chess, type Move } from "chess.js";

export type Wdl = {
  wins: number;
  draws: number;
  losses: number;
};

export type CandidateMove = Wdl & {
  san: string;
  uci: string;
  games: number;
  evalCp: number;
  depth: number;
  pv: string;
  note: string;
  tags: string[];
  source: "sample" | "imported" | "generated";
};

export type BookMoveSeed = {
  path: string[];
  moves: Array<
    Wdl & {
      san: string;
      games: number;
      evalCp: number;
      depth: number;
      pv: string;
      note: string;
      tags: string[];
    }
  >;
};

export type OpeningDatabase = Map<string, CandidateMove[]>;

type ImportedAggregate = {
  move: Move;
  games: number;
  wdl: Wdl;
};

const START_FEN = new Chess().fen();

export function startFen() {
  return START_FEN;
}

export function positionKey(fen: string) {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function buildSampleDatabase(seeds: BookMoveSeed[]): OpeningDatabase {
  const database: OpeningDatabase = new Map();

  for (const entry of seeds) {
    const chess = new Chess();
    for (const san of entry.path) {
      chess.move(san);
    }
    const fen = chess.fen();
    const moves = entry.moves.flatMap((seed) => {
      const probe = new Chess(fen);
      const move = probe.move(seed.san);
      if (!move) return [];
      return [
        {
          ...seed,
          uci: moveToUci(move),
          source: "sample" as const,
        },
      ];
    });
    database.set(positionKey(fen), moves);
  }

  return database;
}

export function mergeCandidates(
  fen: string,
  sample: OpeningDatabase,
  imported: OpeningDatabase,
): CandidateMove[] {
  const key = positionKey(fen);
  const byUci = new Map<string, CandidateMove>();
  for (const move of sample.get(key) ?? []) {
    byUci.set(move.uci, { ...move });
  }
  for (const move of imported.get(key) ?? []) {
    const existing = byUci.get(move.uci);
    if (!existing) {
      byUci.set(move.uci, { ...move });
      continue;
    }
    const games = existing.games + move.games;
    byUci.set(move.uci, {
      ...existing,
      games,
      wins: existing.wins + move.wins,
      draws: existing.draws + move.draws,
      losses: existing.losses + move.losses,
      source: "imported",
      tags: Array.from(new Set([...existing.tags, ...move.tags])),
      note: `${existing.note} Imported PGNs add ${move.games.toLocaleString()} games.`,
    });
  }

  const moves = [...byUci.values()].sort((a, b) => b.games - a.games);
  if (moves.length) return moves;
  return generatedMoves(fen);
}

export function buildImportedDatabase(pgnBlob: string): OpeningDatabase {
  const games = splitPgnGames(pgnBlob);
  const aggregates = new Map<string, Map<string, ImportedAggregate>>();

  for (const raw of games) {
    const chess = new Chess();
    try {
      chess.loadPgn(raw, { strict: false });
    } catch {
      continue;
    }

    const headers = chess.header();
    const result = headers.Result ?? "*";
    const moves = chess.history();
    const walker = makeReplayBoard(headers.FEN);
    for (const san of moves) {
      const fen = walker.fen();
      const key = positionKey(fen);
      const move = walker.move(san);
      if (!move) break;
      const uci = moveToUci(move);
      const byMove = aggregates.get(key) ?? new Map<string, ImportedAggregate>();
      const aggregate = byMove.get(uci) ?? { move, games: 0, wdl: { wins: 0, draws: 0, losses: 0 } };
      aggregate.games += 1;
      addResult(aggregate.wdl, result, walker.turn());
      byMove.set(uci, aggregate);
      aggregates.set(key, byMove);
    }
  }

  const database: OpeningDatabase = new Map();
  for (const [fen, byMove] of aggregates) {
    database.set(
      fen,
      [...byMove.values()]
        .map(({ move, games, wdl }) => ({
          san: move.san,
          uci: moveToUci(move),
          games,
          wins: wdl.wins,
          draws: wdl.draws,
          losses: wdl.losses,
          evalCp: estimatePosition(move.after),
          depth: 18,
          pv: pvFromFen(move.after, 5),
          note: "Imported from your PGN set. Evaluation is a local material and mobility estimate.",
          tags: ["imported"],
          source: "imported" as const,
        }))
        .sort((a, b) => b.games - a.games),
    );
  }

  return database;
}

export function parseFen(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new Chess(trimmed).fen();
  } catch {
    return null;
  }
}

export function scorePercent(move: Wdl) {
  const total = move.wins + move.draws + move.losses;
  if (!total) return 0;
  return Math.round(((move.wins + move.draws * 0.5) / total) * 100);
}

export function moveToUci(move: Move) {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function generatedMoves(fen: string): CandidateMove[] {
  const chess = new Chess(fen);
  return chess
    .moves({ verbose: true })
    .slice(0, 8)
    .map((move, index) => ({
      san: move.san,
      uci: moveToUci(move),
      games: Math.max(1, 80 - index * 7),
      wins: 32 - index,
      draws: 24,
      losses: 24 + index,
      evalCp: estimatePosition(move.after),
      depth: 16,
      pv: pvFromFen(move.after, 5),
      note: "Generated locally because this position is outside the bundled/imported book.",
      tags: ["generated"],
      source: "generated" as const,
    }));
}

function estimatePosition(fen: string) {
  const chess = new Chess(fen);
  const board = chess.board();
  const values: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  let score = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      score += values[piece.type] * (piece.color === "w" ? 1 : -1);
    }
  }
  const mobility = chess.moves().length * (chess.turn() === "w" ? 2 : -2);
  return Math.max(-900, Math.min(900, score + mobility));
}

function pvFromFen(fen: string, plies: number) {
  const chess = new Chess(fen);
  const line: string[] = [];
  for (let i = 0; i < plies && !chess.isGameOver(); i += 1) {
    const legal = chess.moves({ verbose: true });
    legal.sort((a, b) => Math.abs(estimatePosition(b.after)) - Math.abs(estimatePosition(a.after)));
    const move = legal[0];
    if (!move) break;
    line.push(move.san);
    chess.move(move.san);
  }
  return line.join(" ");
}

function splitPgnGames(blob: string) {
  return blob
    .split(/\n(?=\[Event\s)/g)
    .map((game) => game.trim())
    .filter(Boolean);
}

function addResult(wdl: Wdl, result: string, nextTurn: "w" | "b") {
  if (result === "*") return;
  if (result === "1/2-1/2") {
    wdl.draws += 1;
    return;
  }
  const sideThatMoved = nextTurn === "w" ? "b" : "w";
  if ((result === "1-0" && sideThatMoved === "w") || (result === "0-1" && sideThatMoved === "b")) {
    wdl.wins += 1;
  } else if (result === "1-0" || result === "0-1") {
    wdl.losses += 1;
  } else {
    return;
  }
}

function makeReplayBoard(fen: string | null | undefined) {
  if (!fen) return new Chess();
  try {
    return new Chess(fen);
  } catch {
    return new Chess();
  }
}
