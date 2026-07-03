import { describe, expect, it } from "vitest";
import {
  buildImportedDatabase,
  buildSampleDatabase,
  mergeCandidates,
  positionKey,
  scorePercent,
  startFen,
} from "./opening";
import { sampleBook } from "../data/sampleBook";

describe("opening database", () => {
  it("builds sample candidates from SAN paths", () => {
    const database = buildSampleDatabase(sampleBook);
    const moves = database.get(positionKey(startFen()));

    expect(moves?.map((move) => move.san)).toContain("e4");
    expect(moves?.[0].uci).toMatch(/^[a-h][1-8][a-h][1-8]/);
  });

  it("imports PGN games into candidate stats", () => {
    const imported = buildImportedDatabase(`
[Event "Example"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 1-0

[Event "Example 2"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 Nc6 1/2-1/2
`);

    const rootMoves = imported.get(positionKey(startFen()));
    expect(rootMoves?.find((move) => move.san === "e4")?.games).toBe(2);
  });

  it("merges sample and imported moves by UCI", () => {
    const sample = buildSampleDatabase(sampleBook);
    const imported = buildImportedDatabase(`
[Event "Example"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 1-0
`);

    const merged = mergeCandidates(startFen(), sample, imported);
    expect(merged.find((move) => move.san === "e4")?.source).toBe("imported");
    expect(scorePercent({ wins: 1, draws: 1, losses: 0 })).toBe(75);
  });

  it("does not fabricate WDL stats for unknown PGN results", () => {
    const imported = buildImportedDatabase("1. e4 c5 2. Nf3 d6");
    const move = imported.get(positionKey(startFen()))?.find((candidate) => candidate.san === "e4");

    expect(move?.games).toBe(1);
    expect(move?.wins).toBe(0);
    expect(move?.draws).toBe(0);
    expect(move?.losses).toBe(0);
  });

  it("replays imported setup FEN games from their supplied position", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const imported = buildImportedDatabase(`
[SetUp "1"]
[FEN "${fen}"]
[Result "1-0"]

2. Nf3 Nc6 3. Bb5 a6 1-0
`);

    expect(imported.get(positionKey(fen))?.find((move) => move.san === "Nf3")?.games).toBe(1);
  });

  it("normalizes FEN counters during lookup", () => {
    const sample = buildSampleDatabase(sampleBook);
    const sameBoardDifferentCounters = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 42";

    expect(mergeCandidates(sameBoardDifferentCounters, sample, new Map()).map((move) => move.san)).toContain("e4");
  });
});
