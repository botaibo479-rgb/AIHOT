// How the judgments turned out: of the ones that ended in a window, how many met their trigger, failed, ran
// out of time or were withdrawn, and how the price went against its benchmark. Read from the archive's own
// reviews (theses.ts), grouped by market, by what the first card stood on and by who opened it.
import { MARKET_LABELS, REVIEW_NOTE, type Card, type Review, type ReviewGroup, type ReviewStats, type ThesisView } from "../contract.ts";
import { byId } from "./catalog.ts";
import { listTheses } from "./theses.ts";

interface Ended { thesis: ThesisView; at: Date; review: Review }

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function group(label: string, list: Ended[]): ReviewGroup {
  const count = (s: ThesisView["status"]) => list.filter((e) => e.thesis.status === s).length;
  const [triggered, invalidated, expired, withdrawn] = [count("triggered"), count("invalidated"), count("expired"), count("withdrawn")];
  const decided = triggered + invalidated + expired;
  const counted = list.filter((e) => e.thesis.status !== "withdrawn");
  return {
    label, ended: list.length, triggered, invalidated, expired, withdrawn,
    hitRate: decided ? triggered / decided : null,
    meanChange: mean(counted.flatMap((e) => (e.review.change === null ? [] : [e.review.change]))),
    meanExcess: mean(counted.flatMap((e) => (e.review.change === null || e.review.benchmarkChange === null ? [] : [e.review.change - e.review.benchmarkChange]))),
  };
}

function evidenceOf(t: ThesisView): string {
  if (t.origin === "owner") return "站长开立";
  const first = t.revisions[0]!.content as Card;
  const capital = first.evidence.capital.length > 0, rules = first.evidence.rules.length > 0;
  return capital && rules ? "资本＋规则" : capital ? "只有资本" : rules ? "只有规则" : "其他";
}

function groups(list: Ended[], key: (e: Ended) => string): ReviewGroup[] {
  const by = new Map<string, Ended[]>();
  for (const e of list) by.set(key(e), [...(by.get(key(e)) ?? []), e]);
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([label, items]) => group(label, items));
}

/** The judgments that ended within `days` before `now` (all of them when days is null). */
export async function reviewStats(days: number | null, now = new Date()): Promise<ReviewStats> {
  const since = days === null ? null : new Date(now.getTime() - days * 86_400_000);
  const ended: Ended[] = (await listTheses({ open: false })).flatMap((thesis) => {
    const r = [...thesis.revisions].reverse().find((x) => x.kind === "review");
    if (!r) return [];
    const at = new Date(r.at);
    return (!since || at >= since) && at <= now ? [{ thesis, at, review: r.content as Review }] : [];
  });
  return {
    generatedAt: now.toISOString(), window: days === null ? "all" : String(days), note: REVIEW_NOTE,
    overall: group("全部", ended),
    byMarket: groups(ended, (e) => MARKET_LABELS[byId(e.thesis.instrument)?.market ?? "crypto"]),
    byEvidence: groups(ended, (e) => evidenceOf(e.thesis)),
    byOrigin: groups(ended, (e) => (e.thesis.origin === "brief" ? "研究简报" : "站长")),
    recent: ended.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 20).map((e) => ({
      thesisId: e.thesis.id, instrumentName: e.thesis.instrumentName, status: e.thesis.status, endedAt: e.at.toISOString(),
      change: e.review.change, excess: e.review.change !== null && e.review.benchmarkChange !== null ? e.review.change - e.review.benchmarkChange : null, hit: e.review.hit,
    })),
  };
}
