import { Chess } from "chess.js";

export type ExplorerSource = "masters" | "lichess";

export type ExplorerMove = {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
};

export type ExplorerOpening = {
  eco: string;
  name: string;
} | null;

export type ExplorerData = {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: ExplorerOpening;
};

export type CloudPv = {
  sanLine: string[];
  firstUci?: string;
  cp?: number;
  mate?: number;
};

export type CloudEval = {
  depth: number;
  knodes: number;
  pvs: CloudPv[];
};

export type LichessSpeed = "bullet" | "blitz" | "rapid" | "classical";

export type LichessFilters = {
  speeds: LichessSpeed[];
  ratings: number[];
};

export class LichessApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const allSpeeds: LichessSpeed[] = ["bullet", "blitz", "rapid", "classical"];
export const allRatings = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

const explorerCache = new Map<string, ExplorerData>();
const cloudEvalCache = new Map<string, CloudEval | null>();

function getToken() {
  return localStorage.getItem("open-prep-lab-lichess-token")?.trim() ?? "";
}

export function setToken(token: string) {
  localStorage.setItem("open-prep-lab-lichess-token", token.trim());
}

export function hasToken() {
  return getToken().length > 0;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { headers: authHeaders(), signal });
  if (!response.ok) {
    throw new LichessApiError(response.status, describeStatus(response.status));
  }
  return response.json();
}

function describeStatus(status: number) {
  if (status === 401 || status === 403) {
    return "Lichess explorer requires an API token right now. Open “Lichess API token” below the move list and paste a personal token.";
  }
  if (status === 429) {
    return "Lichess is rate-limiting requests. Pause for a minute before continuing.";
  }
  if (status === 404) {
    return "No data for this position.";
  }
  return `Lichess request failed (HTTP ${status}).`;
}

export async function fetchExplorer(
  fen: string,
  source: ExplorerSource,
  filters: LichessFilters,
  signal?: AbortSignal,
): Promise<ExplorerData> {
  const params = new URLSearchParams({ fen, moves: "15", topGames: "0", recentGames: "0" });
  if (source === "lichess") {
    params.set("speeds", (filters.speeds.length ? filters.speeds : allSpeeds).join(","));
    params.set("ratings", (filters.ratings.length ? filters.ratings : allRatings).join(","));
  }
  const url = `https://explorer.lichess.ovh/${source}?${params}`;
  const cached = explorerCache.get(url);
  if (cached) return cached;

  const payload = await getJson(url, signal);
  const data: ExplorerData = {
    white: payload.white ?? 0,
    draws: payload.draws ?? 0,
    black: payload.black ?? 0,
    moves: (payload.moves ?? []).map((move: ExplorerMove) => ({
      uci: move.uci,
      san: move.san,
      white: move.white ?? 0,
      draws: move.draws ?? 0,
      black: move.black ?? 0,
      averageRating: move.averageRating,
    })),
    opening: payload.opening ?? null,
  };
  explorerCache.set(url, data);
  return data;
}

/** Cloud eval covers millions of analyzed positions; returns null when the position is not in the cloud database. */
export async function fetchCloudEval(
  fen: string,
  multiPv: number,
  signal?: AbortSignal,
): Promise<CloudEval | null> {
  const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
  if (cloudEvalCache.has(url)) return cloudEvalCache.get(url) ?? null;

  let payload: { depth: number; knodes: number; pvs: Array<{ moves: string; cp?: number; mate?: number }> };
  try {
    payload = await getJson(url, signal);
  } catch (error) {
    if (error instanceof LichessApiError && error.status === 404) {
      cloudEvalCache.set(url, null);
      return null;
    }
    throw error;
  }

  const data: CloudEval = {
    depth: payload.depth,
    knodes: payload.knodes,
    pvs: (payload.pvs ?? []).map((pv) => {
      const ucis = pv.moves.split(" ");
      return { sanLine: uciLineToSan(fen, ucis), firstUci: ucis[0], cp: pv.cp, mate: pv.mate };
    }),
  };
  cloudEvalCache.set(url, data);
  return data;
}

export type MoveEval = { cp?: number; mate?: number; depth: number };

/** Deep eval for a single position (top line only), used to annotate each candidate move. */
export async function fetchMoveEval(fen: string, signal?: AbortSignal): Promise<MoveEval | null> {
  const cloud = await fetchCloudEval(fen, 1, signal);
  if (!cloud || cloud.pvs.length === 0) return null;
  const top = cloud.pvs[0];
  return { cp: top.cp, mate: top.mate, depth: cloud.depth };
}

export function uciLineToSan(fen: string, ucis: string[]) {
  const chess = new Chess(fen);
  const line: string[] = [];
  for (const uci of ucis) {
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      line.push(move.san);
    } catch {
      break;
    }
  }
  return line;
}
