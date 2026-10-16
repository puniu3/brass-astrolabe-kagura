#!/usr/bin/env python3
"""
Parallel i2i Asset Generator via Codex CLI (`-p openai -i <ref.png>`)
Implements all safeguards from ~/agents/research/_shared/codex-image-gen.md:
- Passes prompt via stdin so `-i <ref.png>` does not swallow the prompt
- Uses CODEX_TIMEOUT=900s to accommodate bimodal latency on complex scenes
- Collects output strictly from ~/.codex/generated_images/<session-id>/ using Python stat mtime (macOS safe, no GNU find -printf dependency)
- Verifies output dimensions and MD5 uniqueness
"""

import concurrent.futures
import hashlib
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REFS_DIR = ROOT / "refs"
RAW_DIR = ROOT / "raw_gen"
LOG_DIR = ROOT / "raw_gen" / "logs"
RAW_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

GEN_DIR = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "generated_images"
TIMEOUT_SEC = int(os.environ.get("CODEX_TIMEOUT", "900"))
MAX_RETRIES = int(os.environ.get("IMGGEN_RETRIES", "3"))

JOBS = [
    {
        "name": "ships_and_enemies",
        "ref": REFS_DIR / "ships_and_enemies_ref.png",
        "out": RAW_DIR / "ships_and_enemies_raw.png",
        "expected_aspect": "landscape",
        "prompt": (
            "A WIDE LANDSCAPE frame with a 3:2 aspect ratio (1536x1024), markedly wider than it is tall — never square and never upright. "
            "1. KEEP the exact layout: every symbol's position, count, and shape stays exactly as in the reference. "
            "This is a 4x3 grid of 12 top-down shoot-em-up game sprites on a pure flat magenta (#FF00FF) background, cells separated by clean magenta gutters, nothing crosses a gutter. "
            "Treat each reference silhouette as a STENCIL: fill it completely, never cross it, do not round mechanical prongs or wings into blobs, do not fill in concave bites. "
            "2. ADD the material: render as an ultra-detailed ornate Japanese clockwork automaton (karakuri) and gilded celestial astrolabe sprite sheet — burnished antique brass filigree, damascened dark obsidian steel, glossy vermilion red urushi lacquer armor plates, and carved celadon jade inlays. "
            "Render as a FLAT top-down orthographic texture sheet — no 3-D perspective drift, no scene lighting, no cast shadows, no ambient occlusion on the magenta background. "
            "3. INERT EMISSIVE: all circular black sockets, cannon muzzle bores, thruster nozzles, and central optic cores are dark inert recesses — unlit, non-glowing, empty dark sockets. Do NOT paint any glow, light emission, or lit core; the engine adds all light at runtime. "
            "4. STRICT PALETTE RULE: NEVER use magenta, pink, rose, violet, or saturated blue anywhere on the ships, items, highlights, or shadows; keep the background pure flat #FF00FF magenta. Do not add any text or numbers."
        ),
    },
    {
        "name": "boss_parts",
        "ref": REFS_DIR / "boss_parts_ref.png",
        "out": RAW_DIR / "boss_parts_raw.png",
        "expected_aspect": "landscape",
        "prompt": (
            "A WIDE LANDSCAPE frame with a 3:2 aspect ratio (1536x1024), markedly wider than it is tall — never square and never upright. "
            "1. KEEP the exact layout: this is a 4x2 grid of 8 multi-part boss rig components on a pure flat magenta (#FF00FF) background, cells separated by clean magenta gutters, nothing crosses a gutter. "
            "Treat each reference silhouette as a STENCIL: fill it completely, never cross it. "
            "Top row left-to-right: (1) complete assembled mechanical deity reference, (2) octagonal obsidian and brass sanctum chassis with concentric gear rings, "
            "(3) serene white porcelain ceremonial mask with golden sun-ray crown and vermilion cheek clasps, (4) hollow engraved brass astrolabe gear ring whose center hole MUST remain pure flat #FF00FF magenta. "
            "Bottom row left-to-right: (5) sweeping mechanical feather-wing pinion of layered brass and vermilion blades, (6) celadon jade and brass stabilizer fin, "
            "(7) heavy twin-barrel dark steel and brass rotary cannon pauldron, (8) ceremonial brass pendulum halberd tail. "
            "2. ADD the material: shared bespoke museum-grade Japanese clockwork automaton craftsmanship across all 8 cells — finely engraved antique brass gears, dark hammered iron, glossy vermilion lacquer, celadon jade stone, and smooth ivory-white porcelain with delicate gold kintsugi veins. "
            "A FLAT top-down orthographic texture sheet — no cast shadows, no scene lighting. "
            "3. INERT EMISSIVE: the mask eye slits, forehead socket, cannon muzzle bores, and circular black recesses are dark inert recesses — unlit, non-glowing, empty dark sockets. Do NOT paint any glow. "
            "4. STRICT PALETTE RULE: NEVER use magenta, pink, rose, violet, or saturated blue anywhere on the parts or shadows; keep the background and the interior of the hollow ring in Cell 4 pure flat #FF00FF magenta. Do not add any text."
        ),
    },
    {
        "name": "stage_bg_abyss",
        "ref": REFS_DIR / "stage_bg_abyss_ref.png",
        "out": RAW_DIR / "stage_bg_abyss_raw.png",
        "expected_aspect": "portrait",
        "prompt": (
            "A TALL VERTICAL PORTRAIT frame with a 2:3 aspect ratio (1024x1536), top-down vertical scrolling shoot-em-up stage background. "
            "The input image is a 3D spatial blocking diagram of a subterranean clockwork temple canyon. "
            "Retain the exact camera framing, stepped left and right canyon walls, three horizontal gilded aqueduct bridges with octagonal medallions, giant sunken brass gears in the chasm, and the winding amber magma river at the bottom, "
            "while replacing proxy geometry with intricate architectural detail: carved dark basalt and obsidian cliff reliefs, weathered antique brass viaduct bridges with vermilion lacquer walkways, colossal sunken clockwork mechanisms, and warm glowing amber-gold magma deep in the abyss. "
            "Consistent overhead illumination from the warm amber magma below and soft golden braziers on the bridges. "
            "Strictly NO text, NO UI, NO characters, NO saturated blue, NO neon purple."
        ),
    },
    {
        "name": "stage_bg_sanctum",
        "ref": REFS_DIR / "stage_bg_sanctum_ref.png",
        "out": RAW_DIR / "stage_bg_sanctum_raw.png",
        "expected_aspect": "portrait",
        "prompt": (
            "A TALL VERTICAL PORTRAIT frame with a 2:3 aspect ratio (1024x1536), top-down vertical scrolling shoot-em-up boss sanctum background. "
            "The input image is a spatial blocking diagram of a grand celestial astrolabe temple floor. "
            "Retain the exact coffered dark obsidian and celadon jade tile grid, the two colossal concentric sunken brass astrolabe gear mandalas with vermilion lacquer inner rings and eight golden radial spokes, and the twin vertical gilded causeway rails along the left and right edges. "
            "Render with rich museum-grade materiality: hammered antique gold, finely engraved bronze zodiac reliefs, dark obsidian stone, and carved celadon jade inlays under warm golden temple illumination. "
            "Strictly NO text, NO UI, NO characters, NO saturated blue, NO neon purple."
        ),
    },
    {
        "name": "hud_and_cutin",
        "ref": REFS_DIR / "hud_and_cutin_ref.png",
        "out": RAW_DIR / "hud_and_cutin_raw.png",
        "expected_aspect": "landscape",
        "prompt": (
            "A WIDE LANDSCAPE frame with a 3:2 aspect ratio (1536x1024), markedly wider than it is tall — never square and never upright. "
            "1. KEEP the exact two-panel slot structure from the reference: "
            "the left rectangular frame contains a dramatic close-up bust portrait of an ornate Japanese clockwork sun-deity automaton wearing a serene ivory-white porcelain Noh mask, gilded brass sun-crown, radial clockwork gear halo, celadon jade forehead cabochon, and layered black-and-vermilion lacquer samurai-mecha pauldrons; "
            "the right rectangular frame is an ornamental antique brass, vermilion lacquer, and flat dark obsidian slate UI border plaque with four corner gear-medallions and three horizontal brass divider bars. "
            "2. In the left portrait, render smooth ivory porcelain with delicate gold kintsugi seams, dark inert unlit eye slits, and dramatic warm amber chiaroscuro lighting. In the right panel, render crisp engraved antique brass metalwork and flat dark obsidian slate interior rectangles. "
            "3. STRICT RULES: Do NOT draw any text, letters, numbers, kanji, or symbols anywhere. NEVER use magenta, pink, or saturated blue."
        ),
    },
]


def run_single_job(job):
    name = job["name"]
    ref_path = str(job["ref"])
    out_path = job["out"]
    prompt = job["prompt"]

    full_prompt = (
        "Call your built-in image_gen tool EXACTLY once to generate this image, then STOP. "
        "Do not copy, move, resize, validate, or otherwise touch the filesystem. "
        "Do not recolor, post-process, verify, or analyze it. "
        f"Image spec: {prompt}"
    )

    for attempt in range(1, MAX_RETRIES + 1):
        t0 = time.time()
        log_file = LOG_DIR / f"{name}_attempt{attempt}.log"
        cmd = [
            "codex",
            "exec",
            "--skip-git-repo-check",
            "--disable",
            "code_mode_host",
            "-p",
            "openai",
            "-c",
            'model_reasoning_effort="low"',
            "-i",
            ref_path,
        ]
        print(f"[{name}] Starting attempt {attempt}/{MAX_RETRIES}...", flush=True)
        try:
            proc = subprocess.run(
                cmd,
                input=full_prompt,
                text=True,
                capture_output=True,
                timeout=TIMEOUT_SEC,
            )
            combined_log = (proc.stdout or "") + "\n" + (proc.stderr or "")
            log_file.write_text(combined_log, encoding="utf-8")
        except subprocess.TimeoutExpired as e:
            combined_log = (e.stdout or "") + "\n" + (e.stderr or "") if isinstance(e.stdout, str) else ""
            log_file.write_text(f"TIMEOUT after {TIMEOUT_SEC}s\n" + combined_log, encoding="utf-8")
            print(f"[{name}] Timeout on attempt {attempt}", flush=True)

        # Extract session id
        log_text = log_file.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"session id:\s*([0-9a-fA-F-]+)", log_text)
        sid = m.group(1) if m else None

        if sid:
            sdir = GEN_DIR / sid
            if sdir.is_dir():
                pngs = sorted(sdir.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
                if pngs:
                    newest = pngs[0]
                    shutil.copy2(newest, out_path)
                    im = Image.open(out_path)
                    w, h = im.size
                    md5 = hashlib.md5(out_path.read_bytes()).hexdigest()[:10]
                    dt = time.time() - t0
                    print(f"[{name}] SUCCESS in {dt:.1f}s -> {out_path.name} ({w}x{h}, md5={md5}, sid={sid})", flush=True)
                    return {"name": name, "ok": True, "size": (w, h), "md5": md5, "sid": sid, "sec": round(dt, 1)}

        print(f"[{name}] Attempt {attempt} produced no image (sid={sid}), retrying...", flush=True)
        time.sleep(2)

    print(f"[{name}] FAILED after {MAX_RETRIES} attempts.", flush=True)
    return {"name": name, "ok": False}


def main():
    selected = sys.argv[1:] if len(sys.argv) > 1 else [j["name"] for j in JOBS]
    jobs_to_run = [j for j in JOBS if j["name"] in selected]
    # Run with max_workers=3 to respect rate limits while maximizing throughput
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(run_single_job, j): j["name"] for j in jobs_to_run}
        for fut in concurrent.futures.as_completed(futs):
            results.append(fut.result())

    # Verify MD5 uniqueness across outputs
    seen_md5 = {}
    for r in results:
        if r.get("ok"):
            h = r["md5"]
            if h in seen_md5:
                print(f"WARNING: Duplicate MD5 detected between {r['name']} and {seen_md5[h]}!", flush=True)
            seen_md5[h] = r["name"]

    failed = [r["name"] for r in results if not r.get("ok")]
    if failed:
        print(f"Failed jobs: {failed}", file=sys.stderr)
        sys.exit(1)
    print("All i2i jobs completed successfully!", flush=True)


if __name__ == "__main__":
    main()
