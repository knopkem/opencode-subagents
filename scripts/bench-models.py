#!/usr/bin/env python3
"""Benchmark prefill and decode speed to pick a fast implementer.

Lists the models reported by `opencode models`, lets you pick any number of
them, then measures each model with `opencode run` using wall-clock deltas
against a tiny baseline run (which cancels CLI startup and the fixed system
prompt):

    warmup    tiny prompt, primes the provider prompt cache (not measured)
    baseline  two tiny prompts, measured to cancel CLI startup + system prompt
    prefill   large filler prompt (+ a one-word reply)
              rate = marginal input tokens / marginal wall time
    decode    a request for a deterministic ~250-token answer
              rate = marginal output+reasoning tokens / marginal wall time

Reported numbers are medians over `--runs` repetitions (default 3). Models are
independent, so `--jobs N` benchmarks N of them at once; keep it low (`2`-`3`)
since local CPU contention and provider-side rate limits add noise.

Use the winner as the builder with `scripts/set-models.py`.

Usage:
    scripts/bench-models.py                       interactive multi-select
    scripts/bench-models.py --list                print numbered model list
    scripts/bench-models.py MODEL [MODEL ...]     non-interactive
    scripts/bench-models.py -j 4 MODEL ...        benchmark 4 models at once
    scripts/bench-models.py -n 5 MODEL ...        repeat each probe 5 times
    scripts/bench-models.py --json MODEL ...      machine-readable results
    scripts/bench-models.py --prefill-words 6000 --decode-count 400 MODEL
    scripts/bench-models.py --timeout 300 MODEL ...
"""

import concurrent.futures
import json
import random
import re
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")
MODEL_ID = re.compile(r"[A-Za-z0-9_.@-]+/[^\s/]+(?:/[^\s/]+)*")

ROOT = Path(__file__).resolve().parent.parent
SELECTION = ROOT / "models.local.json"

WORDS = (
    "the of and to in a is that for it as was with be by on not he this are or "
    "his from at which but have an they one you were her all she there would "
    "their we him been has when who will more no if out so said what up its "
    "about into than them can only other new some could time these two may then "
    "do first any my now such like our over man me even most made after also did "
    "many before must through back years where much your way well down should "
    "because each just those people how too little state good very make world "
    "still own see men work long get here between both life being under never "
    "day same another know while last might us great old year off come since "
    "against go came right used take three"
).split()

TINY_PROMPT = "Reply with exactly: OK"
PREFILL_SUFFIX = "\n\nReply with exactly: OK"


def list_models():
    try:
        out = subprocess.run(
            ["opencode", "models"], capture_output=True, text=True, check=True
        ).stdout
    except FileNotFoundError:
        sys.exit("error: 'opencode' not found on PATH")
    except subprocess.CalledProcessError as e:
        sys.exit(f"error: 'opencode models' failed: {e}")

    models, seen = [], set()
    for line in ANSI.sub("", out).splitlines():
        line = line.strip()
        if MODEL_ID.fullmatch(line) and line not in seen:
            seen.add(line)
            models.append(line)
    return models


def resolve(token, models):
    if token.isdigit():
        index = int(token)
        if 1 <= index <= len(models):
            return models[index - 1]
        raise ValueError(f"number out of range: {token}")
    if token in models:
        return token
    matches = [m for m in models if token.lower() in m.lower()]
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise ValueError(f"ambiguous: {token} ({', '.join(matches[:5])})")
    raise ValueError(f"no match: {token}")


def select_models(models):
    print("\nAvailable models:\n")
    for i, m in enumerate(models, 1):
        print(f"  {i:>3}) {m}")
    while True:
        ans = input(
            "\nmodels to benchmark (numbers/substrings, comma-separated, 'all', q to quit): "
        ).strip()
        if ans.lower() in ("q", "quit", "exit"):
            sys.exit("aborted")
        tokens = [t.strip() for t in ans.split(",") if t.strip()]
        if not tokens:
            print("Nothing selected, try again.")
            continue
        if len(tokens) == 1 and tokens[0].lower() in ("all", "*"):
            return list(models)
        chosen, bad = [], False
        for token in tokens:
            try:
                model = resolve(token, models)
            except ValueError as e:
                print(f"  {e}")
                bad = True
                break
            if model not in chosen:
                chosen.append(model)
        if bad or not chosen:
            continue
        if len(chosen) > 8:
            confirm = input(f"  benchmark {len(chosen)} models? [y/N]: ").strip().lower()
            if confirm not in ("y", "yes"):
                continue
        return chosen


def take_option(args, *names, default=None):
    value = default
    kept = []
    i = 0
    while i < len(args):
        token = args[i]
        name = next((n for n in names if token == n or token.startswith(n + "=")), None)
        if name is None:
            kept.append(token)
            i += 1
            continue
        if token.startswith(name + "="):
            value = token[len(name) + 1:]
            i += 1
        else:
            if i + 1 >= len(args):
                sys.exit(f"error: {name} needs a value")
            value = args[i + 1]
            i += 2
    args[:] = kept
    return value


def decode_prompt(count):
    return (
        f"Write the integers from 1 to {count} separated by commas on a single "
        "line. Output only the numbers."
    )


def run_probe(model, prompt, timeout):
    started = time.perf_counter()
    try:
        proc = subprocess.run(
            ["opencode", "run", "--format", "json", "-m", model, prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"wall": timeout, "error": f"timeout after {timeout:g}s"}
    except FileNotFoundError:
        sys.exit("error: 'opencode' not found on PATH")

    result = {
        "wall": time.perf_counter() - started,
        "error": None,
        "tokens": None,
        "cost": None,
    }
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = event.get("type")
        part = event.get("part") or {}
        if kind == "step_finish" and result["tokens"] is None:
            result["tokens"] = part.get("tokens") or {}
            result["cost"] = part.get("cost")
        elif kind == "error":
            err = event.get("error") or {}
            data = err.get("data") if isinstance(err, dict) else None
            result["error"] = data.get("message") if isinstance(data, dict) else str(err)

    if result["error"] is None and not result["tokens"]:
        detail = (proc.stderr or "").strip().splitlines()
        result["error"] = detail[-1] if detail else f"no result (exit {proc.returncode})"
    return result


def counts(result):
    tokens = result.get("tokens") or {}
    cache = tokens.get("cache") or {}
    return {
        "input": tokens.get("input") or 0,
        "cached": cache.get("read") or 0,
        "total_input": (tokens.get("input") or 0) + (cache.get("read") or 0),
        "output": tokens.get("output") or 0,
        "reasoning": tokens.get("reasoning") or 0,
        "generated": (tokens.get("output") or 0) + (tokens.get("reasoning") or 0),
        "cost": result.get("cost"),
    }


def rate(tokens, seconds):
    if tokens is None or seconds is None or tokens <= 0 or seconds <= 0:
        return None
    return tokens / seconds


def describe(entry):
    if entry.get("error"):
        return f"failed: {entry['error']}"
    pre = f"{entry['prefill_tps']:,.0f}" if entry.get("prefill_tps") else "-"
    dec = f"{entry['decode_tps']:,.0f}" if entry.get("decode_tps") else "-"
    return (
        f"prefill {pre:>7} tok/s ({entry['prefill_tokens']:,} tok in "
        f"{entry['prefill_window']:.2f}s)  decode {dec:>6} tok/s "
        f"({entry['decode_tokens']:,} tok in {entry['decode_window']:.2f}s)"
    )


def benchmark(model, runs, prefill_words, decode_count, timeout, log):
    warmup = run_probe(model, TINY_PROMPT, timeout)
    if warmup["error"]:
        return {"model": model, "error": warmup["error"], "raw": []}

    baselines = []
    for _ in range(2):
        base = run_probe(model, TINY_PROMPT, timeout)
        if base["error"]:
            return {"model": model, "error": base["error"], "raw": []}
        baselines.append(base)
    base = min(baselines, key=lambda r: (counts(r)["generated"] > 8, r["wall"]))
    b = counts(base)
    b_wall = base["wall"]
    log(f"  baseline {b_wall:.2f}s (in {b['total_input']:,}, gen {b['generated']:,})")

    rng = random.Random()
    raw = []
    for run in range(runs):
        filler = " ".join(rng.choice(WORDS) for _ in range(prefill_words))
        prefill = run_probe(model, filler + PREFILL_SUFFIX, timeout)
        decode = run_probe(model, decode_prompt(decode_count), timeout)
        error = prefill.get("error") or decode.get("error")
        if error:
            entry = {"error": error}
        else:
            p, d = counts(prefill), counts(decode)
            entry = {
                "prefill_tokens": p["total_input"] - b["total_input"],
                "prefill_window": prefill["wall"] - b_wall,
                "decode_tokens": d["generated"] - b["generated"],
                "decode_window": decode["wall"] - b_wall,
                "output": d["output"],
                "reasoning": d["reasoning"],
                "cost": sum(
                    c for c in (p["cost"], d["cost"]) if c is not None
                )
                or None,
            }
            entry["prefill_tps"] = rate(entry["prefill_tokens"], entry["prefill_window"])
            entry["decode_tps"] = rate(entry["decode_tokens"], entry["decode_window"])
        raw.append(entry)
        log(f"  run {run + 1}/{runs}: {describe(entry)}")

    good = [e for e in raw if not e.get("error")]
    if not good:
        return {"model": model, "error": raw[0].get("error") or "no successful runs", "raw": raw}

    def median(key):
        values = [e[key] for e in good if e.get(key) is not None]
        return statistics.median(values) if values else None

    summary = {key: median(key) for key in (
        "prefill_tps",
        "decode_tps",
        "prefill_tokens",
        "prefill_window",
        "decode_tokens",
        "decode_window",
        "output",
        "reasoning",
        "cost",
    )}
    return {"model": model, "error": None, "overhead": b_wall, "median": summary, "raw": raw}


def current_planner():
    if not SELECTION.exists():
        return None
    try:
        return json.loads(SELECTION.read_text()).get("planner")
    except (OSError, json.JSONDecodeError):
        return None


def print_report(results, runs):
    ok = [r for r in results if not r["error"]]
    ok.sort(key=lambda r: r["median"]["decode_tps"] or 0, reverse=True)
    failed = [r for r in results if r["error"]]

    header = (
        f"{'model':<40}{'prefill t/s':>12}{'decode t/s':>12}"
        f"{'in tok':>8}{'gen tok':>8}{'overhead':>10}{'cost':>10}"
    )
    print(header)
    print("-" * len(header))
    for r in ok:
        m = r["median"]
        prefill = f"{m['prefill_tps']:,.0f}" if m["prefill_tps"] else "-"
        decode = f"{m['decode_tps']:,.0f}" if m["decode_tps"] else "-"
        in_tok = f"{m['prefill_tokens']:,.0f}" if m["prefill_tokens"] is not None else "-"
        gen_tok = f"{m['decode_tokens']:,.0f}" if m["decode_tokens"] is not None else "-"
        if m["reasoning"]:
            gen_tok += f"+r{m['reasoning']:,.0f}"
        overhead = f"{r['overhead']:.2f}s"
        cost = f"${m['cost']:.4f}" if m["cost"] else "-"
        print(
            f"{r['model']:<40}{prefill:>12}{decode:>12}{in_tok:>8}{gen_tok:>8}"
            f"{overhead:>10}{cost:>10}"
        )
    for r in failed:
        print(f"{r['model']:<40}  failed: {r['error']}")
    print()
    print(f"(medians of {runs} run(s); rates are marginal over the baseline run)")

    if ok:
        best = ok[0]
        m = best["median"]
        prefill = f"{m['prefill_tps']:,.0f}" if m["prefill_tps"] else "?"
        print(
            f"\nfastest implementer: {best['model']} "
            f"({m['decode_tps'] or 0:,.0f} tok/s decode, {prefill} tok/s prefill)"
        )
        planner = current_planner()
        if planner:
            print(f"apply as builder: scripts/set-models.py {planner} {best['model']}")
        else:
            print(
                "apply as builder: scripts/set-models.py <planner-model> "
                f"{best['model']}"
            )


def main():
    args = sys.argv[1:]
    models = list_models()

    if "--list" in args:
        for i, m in enumerate(models, 1):
            print(f"{i:>3}) {m}")
        return

    runs = int(take_option(args, "--runs", "-n", default="3"))
    jobs = int(take_option(args, "--jobs", "-j", default="1"))
    prefill_words = int(take_option(args, "--prefill-words", default="4000"))
    decode_count = int(take_option(args, "--decode-count", default="250"))
    timeout = float(take_option(args, "--timeout", default="180"))
    as_json = "--json" in args
    args = [a for a in args if not a.startswith("-")]

    if runs < 1 or jobs < 1 or prefill_words < 1 or decode_count < 1:
        sys.exit("error: --runs, --jobs, --prefill-words and --decode-count must be positive")

    if args:
        chosen = []
        for token in args:
            try:
                model = resolve(token, models)
            except ValueError as e:
                sys.exit(f"error: {e}")
            if model not in chosen:
                chosen.append(model)
    elif as_json:
        sys.exit("error: --json needs explicit model arguments")
    else:
        chosen = select_models(models)

    out = sys.stderr if as_json else sys.stdout
    lock = threading.Lock()

    def make_log(model):
        prefix = f"[{model}] " if jobs > 1 else ""

        def log(*parts):
            with lock:
                print(prefix + " ".join(str(p) for p in parts), file=out)

        return log

    if not as_json:
        print(f"\nbenchmarking {len(chosen)} model(s), {runs} run(s) each\n")

    def run_one(model, log):
        try:
            return benchmark(model, runs, prefill_words, decode_count, timeout, log)
        except Exception as e:
            return {"model": model, "error": f"{type(e).__name__}: {e}", "raw": []}

    results = []
    if jobs == 1 or len(chosen) == 1:
        for model in chosen:
            log = make_log(model)
            log(model)
            results.append(run_one(model, log))
            log("")
    else:
        workers = min(jobs, len(chosen))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = []
            for model in chosen:
                log = make_log(model)
                log(model)
                futures.append(pool.submit(run_one, model, log))
            results = [future.result() for future in futures]

    if as_json:
        print(json.dumps({"runs": runs, "results": results}, indent=2))
        return

    print_report(results, runs)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\naborted")
