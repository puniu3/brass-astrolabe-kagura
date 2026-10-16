#!/usr/bin/env python3
"""
Deterministic 4-Stage Chroma Keyer, Ref-BBox/Centroid Aligner, Normal Map & Emissive Extractor,
and Quantitative Gate Auditor (`procedural-i2i` §9 & Gate Table).

Pipeline per Joint Sheet (`ships_and_enemies`, `boss_parts`):
1. Scale raw i2i output (if needed) to match reference sheet dimensions (1536x1024).
2. Measure gutter spill along the reference gutter bands before slicing.
3. For each cell rect (already inset by 6px to exclude the thin slot border):
   a. Provenance-based explicit #FF00FF chroma key (not border flood-fill, so hollow rings like
      `boss_astrolabe_ring` get their interior hole cleanly extracted).
   b. 1px alpha erosion (`MinFilter(3)`) to remove anti-aliased magenta edge fringe.
   c. Internal despill: pixels with `alpha > 0 and (R - G > 45) and (B - G > 35)` have their
      magenta spill neutralized (clamped/replaced by warm brass/neighbor tone) so fringe_ratio == 0.000.
   d. Ref-bbox & centroid alignment: aligns the extracted cell's alpha bounding box / centroid to
      the procedural reference cell's alpha bounding box so mechanical pivots and sockets stay locked.
4. Derive tangent-space Normal Map (`*_normal.png`) via multi-scale Sobel relief gradients
   and Emissive Socket Mask (`*_emissive.png`) from the reference socket coordinates + dark recess detection.
5. Audit photosensitivity safety (assert 0% large saturated blue regions) and write `public/assets/audit_report.json`.
"""

import json
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REFS_DIR = ROOT / "refs"
RAW_DIR = ROOT / "raw_gen"
ASSETS_DIR = ROOT / "public" / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


def explicit_magenta_keyer(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Stage 1-3 of `prompt-clauses.md` §9:
    1. Explicit #FF00FF provenance key with soft ramp (works inside hollow rings too!)
    2. 1px alpha erosion (MinFilter(3))
    3. Internal despill of any residual magenta-family pixels (`r-g > 45 and b-g > 35`)
    Returns RGBA uint8 array.
    """
    r = rgb_arr[:, :, 0].astype(np.float32)
    g = rgb_arr[:, :, 1].astype(np.float32)
    b = rgb_arr[:, :, 2].astype(np.float32)

    # Distance from pure magenta (255, 0, 255) plus green-suppression metric
    # Pure magenta has high R, low G, high B.
    mag_ness = (np.minimum(r, b) - g)  # 255 for #FF00FF, <=0 for warm tones where G >= B
    dist_mag = np.sqrt((255.0 - r) ** 2 + (g - 0.0) ** 2 + (255.0 - b) ** 2)

    # Soft matte ramp: transparent when dist_mag < 75 or mag_ness > 135
    alpha_dist = np.clip((dist_mag - 62.0) / (138.0 - 62.0), 0.0, 1.0)
    alpha_mag = np.clip((145.0 - mag_ness) / (145.0 - 65.0), 0.0, 1.0)
    alpha = np.minimum(alpha_dist, alpha_mag)
    alpha_u8 = (alpha * 255.0).astype(np.uint8)

    # Stage 2: 1px alpha erosion via PIL MinFilter(3)
    alpha_pil = Image.fromarray(alpha_u8, mode="L").filter(ImageFilter.MinFilter(3))
    alpha_eroded = np.array(alpha_pil, dtype=np.uint8)

    # Zero out RGB where alpha == 0
    out_r = r.copy()
    out_g = g.copy()
    out_b = b.copy()

    # Stage 3: Internal despill — predicate `opaque & (r - g > 40) & (b - g > 30)`
    # Since magenta/pink/violet is banned from the artwork palette (warm brass/vermilion/jade/obsidian/ivory),
    # any pixel where B > G + 25 and R > G + 35 is magenta spill.
    spill_mask = (alpha_eroded > 0) & ((out_r - out_g) > 38.0) & ((out_b - out_g) > 26.0)
    if np.any(spill_mask):
        # Neutralize magenta spill into warm bronze/umbrian tone preserving luminance
        lum = 0.299 * out_r + 0.587 * out_g + 0.114 * out_b
        out_r[spill_mask] = np.clip(lum[spill_mask] * 1.08, 0, 255)
        out_g[spill_mask] = np.clip(lum[spill_mask] * 0.88, 0, 255)
        out_b[spill_mask] = np.clip(lum[spill_mask] * 0.62, 0, 255)

    # Also enforce zero saturated blue (`B - R > 45 and B - G > 35`) for photosensitivity safety
    blue_mask = (alpha_eroded > 0) & ((out_b - out_r) > 40.0) & ((out_b - out_g) > 30.0)
    if np.any(blue_mask):
        out_b[blue_mask] = np.minimum(out_b[blue_mask], out_g[blue_mask] + 15.0)

    rgba = np.stack([
        np.clip(out_r, 0, 255).astype(np.uint8),
        np.clip(out_g, 0, 255).astype(np.uint8),
        np.clip(out_b, 0, 255).astype(np.uint8),
        alpha_eroded,
    ], axis=-1)
    rgba[alpha_eroded == 0] = (0, 0, 0, 0)
    return rgba


def align_cell_to_ref(cell_rgba: np.ndarray, ref_rgba: np.ndarray, is_hollow_ring: bool = False):
    """
    Stage 4 of `prompt-clauses.md` §9:
    Aligns the generated cell's alpha bounding box / centroid to the reference cell's alpha bounding box
    so pivots and sockets remain registered.
    Returns (aligned_rgba, metrics_dict).
    """
    h, w, _ = ref_rgba.shape
    ref_mask = ref_rgba[:, :, 3] > 128
    gen_mask = cell_rgba[:, :, 3] > 64

    if not np.any(ref_mask) or not np.any(gen_mask):
        return cell_rgba, {"centroid_drift_px": 0.0, "iou": 0.0}

    ry, rx = np.nonzero(ref_mask)
    gy, gx = np.nonzero(gen_mask)

    ref_cx, ref_cy = float(np.mean(rx)), float(np.mean(ry))
    gen_cx, gen_cy = float(np.mean(gx)), float(np.mean(gy))
    raw_drift = math.hypot(gen_cx - ref_cx, gen_cy - ref_cy)

    # Bounding boxes
    rx0, rx1 = int(rx.min()), int(rx.max()) + 1
    ry0, ry1 = int(ry.min()), int(ry.max()) + 1
    gx0, gx1 = int(gx.min()), int(gx.max()) + 1
    gy0, gy1 = int(gy.min()), int(gy.max()) + 1

    rw, rh = max(1, rx1 - rx0), max(1, ry1 - ry0)
    gw, gh = max(1, gx1 - gx0), max(1, gy1 - gy0)

    # Crop generated subject and scale smoothly to fit reference bbox within [0.85, 1.18] clamp
    scale_x = np.clip(rw / gw, 0.84, 1.18)
    scale_y = np.clip(rh / gh, 0.84, 1.18)
    # Keep aspect-locked or gentle bbox fit
    scale = 0.5 * (scale_x + scale_y)
    new_w = max(1, min(w, int(round(gw * scale))))
    new_h = max(1, min(h, int(round(gh * scale))))

    crop_pil = Image.fromarray(cell_rgba[gy0:gy1, gx0:gx1], mode="RGBA")
    resized_pil = crop_pil.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Place centered on ref bbox center
    rcx_box = (rx0 + rx1) // 2
    rcy_box = (ry0 + ry1) // 2
    px0 = int(round(rcx_box - new_w / 2))
    py0 = int(round(rcy_box - new_h / 2))

    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(resized_pil, (px0, py0))
    aligned = np.array(canvas, dtype=np.uint8)

    # If hollow ring, ensure inner circular hole is preserved cleanly
    if is_hollow_ring:
        yy, xx = np.mgrid[0:h, 0:w]
        dist_center = np.sqrt((xx - w / 2.0) ** 2 + (yy - h / 2.0) ** 2)
        inner_hole = dist_center < 88.0
        inner_feather = np.clip((dist_center - 84.0) / 14.0, 0.0, 1.0)
        aligned[:, :, 3] = (aligned[:, :, 3].astype(np.float32) * inner_feather).astype(np.uint8)
        aligned[inner_hole, :3] = 0

    al_mask = aligned[:, :, 3] > 64
    inter = float(np.logical_and(ref_mask, al_mask).sum())
    union = float(np.logical_or(ref_mask, al_mask).sum())
    iou = inter / max(1.0, union)

    ay, ax = np.nonzero(al_mask)
    post_drift = math.hypot(float(np.mean(ax)) - ref_cx, float(np.mean(ay)) - ref_cy) if len(ax) else 0.0

    return aligned, {
        "raw_centroid_drift_px": round(raw_drift, 2),
        "post_centroid_drift_px": round(post_drift, 2),
        "bbox_iou": round(iou, 3),
    }


def generate_normal_map(rgba_or_rgb: np.ndarray, strength: float = 3.2) -> Image.Image:
    """
    Computes a rich multi-scale tangent-space normal map (R=nx, G=ny, B=nz) from albedo luminance & alpha relief.
    Used by WebGL2 shaders for real-time dynamic point-light rim & relief illumination.
    """
    arr = rgba_or_rgb.astype(np.float32) / 255.0
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    if arr.shape[2] == 4:
        alpha = arr[:, :, 3]
        # Combine internal surface engraving detail with smooth dome bevel near silhouette edges
        bevel_pil = Image.fromarray((alpha * 255).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(radius=4.5))
        bevel = np.array(bevel_pil, dtype=np.float32) / 255.0
        height = 0.55 * lum * (alpha > 0.05) + 0.45 * bevel
    else:
        height = lum

    # Multi-scale Sobel gradients (fine detail + broad relief)
    h_fine = height
    h_broad = np.array(
        Image.fromarray((np.clip(height, 0, 1) * 255).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(radius=2.2)),
        dtype=np.float32,
    ) / 255.0

    def sobel_xy(h_field):
        gx = (
            -1.0 * np.roll(np.roll(h_field, 1, axis=0), 1, axis=1)
            - 2.0 * np.roll(h_field, 1, axis=1)
            - 1.0 * np.roll(np.roll(h_field, -1, axis=0), 1, axis=1)
            + 1.0 * np.roll(np.roll(h_field, 1, axis=0), -1, axis=1)
            + 2.0 * np.roll(h_field, -1, axis=1)
            + 1.0 * np.roll(np.roll(h_field, -1, axis=0), -1, axis=1)
        )
        gy = (
            -1.0 * np.roll(np.roll(h_field, 1, axis=0), 1, axis=1)
            - 2.0 * np.roll(h_field, 1, axis=0)
            - 1.0 * np.roll(np.roll(h_field, 1, axis=0), -1, axis=1)
            + 1.0 * np.roll(np.roll(h_field, -1, axis=0), 1, axis=1)
            + 2.0 * np.roll(h_field, -1, axis=0)
            + 1.0 * np.roll(np.roll(h_field, -1, axis=0), -1, axis=1)
        )
        return gx, gy

    gx1, gy1 = sobel_xy(h_fine)
    gx2, gy2 = sobel_xy(h_broad)
    nx = -(0.65 * gx1 + 0.35 * gx2) * strength
    ny = -(0.65 * gy1 + 0.35 * gy2) * strength
    nz = np.ones_like(nx)

    norm = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
    nx /= norm
    ny /= norm
    nz /= norm

    out = np.stack([
        ((nx * 0.5 + 0.5) * 255.0).astype(np.uint8),
        ((ny * 0.5 + 0.5) * 255.0).astype(np.uint8),
        ((nz * 0.5 + 0.5) * 255.0).astype(np.uint8),
    ], axis=-1)
    return Image.fromarray(out, mode="RGB")


def build_emissive_mask(sheet_meta: dict, atlas_rgba: np.ndarray) -> Image.Image:
    """
    Creates an RGBA emissive socket mask matching the sheet dimensions:
    R = core/socket intensity, G = rim/circuit highlight, B = socket phase offset.
    Strictly placed at the procedural `emissive_sockets` coordinates so inert-emissive
    recesses ignite cleanly in the WebGL2 shader.
    """
    W, H = sheet_meta["size"]
    mask = np.zeros((H, W, 3), dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W]

    for idx, cell in enumerate(sheet_meta["cells"]):
        cx, cy = cell["center"]
        for s_idx, sock in enumerate(cell.get("emissive_sockets", [])):
            sx = cx + sock["dx"]
            sy = cy + sock["dy"]
            sr = float(sock["r"])
            dist = np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2)
            core = np.clip(1.0 - (dist / (sr * 1.25)) ** 2, 0.0, 1.0)
            ring = np.exp(-((dist - sr * 0.95) ** 2) / max(2.0, (sr * 0.28) ** 2))
            phase = ((idx * 37 + s_idx * 73) % 255) / 255.0
            mask[:, :, 0] = np.maximum(mask[:, :, 0], core)
            mask[:, :, 1] = np.maximum(mask[:, :, 1], ring * 0.85)
            mask[dist < sr * 1.35, 2] = phase

    return Image.fromarray((np.clip(mask, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGB")


def process_joint_sheet(sheet_key: str, sheet_meta: dict, raw_path: Path, ref_path: Path):
    W, H = sheet_meta["size"]
    ref_img = Image.open(ref_path).convert("RGB")
    ref_arr = np.array(ref_img, dtype=np.uint8)
    ref_keyed = explicit_magenta_keyer(ref_arr)

    if raw_path.exists():
        raw_img = Image.open(raw_path).convert("RGB")
        if raw_img.size != (W, H):
            raw_img = raw_img.resize((W, H), Image.Resampling.LANCZOS)
        raw_arr = np.array(raw_img, dtype=np.uint8)
        source_mode = "i2i_codex"
    else:
        raw_arr = ref_arr.copy()
        source_mode = "procedural_fallback"

    # Key the entire sheet
    keyed_full = explicit_magenta_keyer(raw_arr)

    # Measure gutter spill along the outer/inter-cell gutter bands (excluding slot_rect)
    slot_mask = np.zeros((H, W), dtype=bool)
    for cell in sheet_meta["cells"]:
        sx0, sy0, sx1, sy1 = cell["slot_rect"]
        slot_mask[sy0:sy1 + 1, sx0:sx1 + 1] = True
    gutter_alpha = keyed_full[:, :, 3][~slot_mask]
    gutter_spill_pct = float((gutter_alpha > 32).sum()) / max(1, gutter_alpha.size) * 100.0

    # Assemble clean aligned atlas where ONLY inset cell rects are populated and aligned
    clean_atlas = np.zeros((H, W, 4), dtype=np.uint8)
    cell_reports = {}

    for cell in sheet_meta["cells"]:
        rx0, ry0, rx1, ry1 = cell["rect"]
        cell_raw_rgba = keyed_full[ry0:ry1, rx0:rx1]
        cell_ref_rgba = ref_keyed[ry0:ry1, rx0:rx1]
        is_ring = cell["key"] == "boss_astrolabe_ring"
        aligned_rgba, c_metrics = align_cell_to_ref(cell_raw_rgba, cell_ref_rgba, is_hollow_ring=is_ring)
        clean_atlas[ry0:ry1, rx0:rx1] = aligned_rgba
        cell_reports[cell["key"]] = c_metrics

    # Post-resample despill pass to eliminate any Lanczos interpolation fringe
    a_mask = clean_atlas[:, :, 3] > 0
    r_ch = clean_atlas[:, :, 0].astype(np.float32)
    g_ch = clean_atlas[:, :, 1].astype(np.float32)
    b_ch = clean_atlas[:, :, 2].astype(np.float32)
    post_spill = a_mask & ((r_ch - g_ch) > 38.0) & ((b_ch - g_ch) > 26.0)
    if np.any(post_spill):
        lum = 0.299 * r_ch + 0.587 * g_ch + 0.114 * b_ch
        clean_atlas[:, :, 0][post_spill] = np.clip(lum[post_spill] * 1.08, 0, 255).astype(np.uint8)
        clean_atlas[:, :, 1][post_spill] = np.clip(lum[post_spill] * 0.88, 0, 255).astype(np.uint8)
        clean_atlas[:, :, 2][post_spill] = np.clip(lum[post_spill] * 0.62, 0, 255).astype(np.uint8)

    # Verify post-despill magenta fringe ratio on clean_atlas
    a = clean_atlas[:, :, 3] > 0
    r = clean_atlas[:, :, 0].astype(np.int32)
    g = clean_atlas[:, :, 1].astype(np.int32)
    b = clean_atlas[:, :, 2].astype(np.int32)
    fringe_pixels = int(np.logical_and(a, (r - g > 45) & (b - g > 35)).sum())
    opaque_pixels = max(1, int(a.sum()))
    fringe_ratio = fringe_pixels / opaque_pixels

    atlas_out = ASSETS_DIR / f"{sheet_key}_atlas.png"
    normal_out = ASSETS_DIR / f"{sheet_key}_normal.png"
    emissive_out = ASSETS_DIR / f"{sheet_key}_emissive.png"

    Image.fromarray(clean_atlas, mode="RGBA").save(atlas_out)
    generate_normal_map(clean_atlas, strength=3.5).save(normal_out)
    build_emissive_mask(sheet_meta, clean_atlas).save(emissive_out)

    return {
        "source_mode": source_mode,
        "gutter_spill_pct": round(gutter_spill_pct, 4),
        "magenta_fringe_ratio": round(fringe_ratio, 6),
        "cells": cell_reports,
    }


def make_vertical_seamless(img: Image.Image, blend_rows: int = 160) -> Image.Image:
    """Crossfades top and bottom band so vertical scrolling in WebGL2 has zero seam."""
    arr = np.array(img, dtype=np.float32)
    H, W, C = arr.shape
    out = np.roll(arr, H // 2, axis=0)
    # Smoothly blend the middle seam (which was the wrap boundary) using a raised cosine window
    mid = H // 2
    half_b = blend_rows // 2
    for dy in range(-half_b, half_b):
        y = (mid + dy) % H
        t = (dy + half_b) / float(2 * half_b)
        w_blend = 0.5 - 0.5 * math.cos(t * math.pi)
        src_y = (y + H // 2) % H
        out[y] = (1.0 - w_blend) * out[y] + w_blend * arr[src_y]
    # Suppress any accidental blue cast
    r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
    blue_excess = (b - r > 30) & (b - g > 20)
    b[blue_excess] = np.minimum(b[blue_excess], g[blue_excess] + 10)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGB")


def process_stage_bgs():
    reports = {}
    for bg_name in ("abyss", "sanctum"):
        raw_p = RAW_DIR / f"stage_bg_{bg_name}_raw.png"
        ref_p = REFS_DIR / f"stage_bg_{bg_name}_ref.png"
        src_p = raw_p if raw_p.exists() else ref_p
        img = Image.open(src_p).convert("RGB").resize((1024, 1536), Image.Resampling.LANCZOS)
        seamless = make_vertical_seamless(img, blend_rows=180)
        out_p = ASSETS_DIR / f"stage_bg_{bg_name}.png"
        norm_p = ASSETS_DIR / f"stage_bg_{bg_name}_normal.png"
        seamless.save(out_p)
        generate_normal_map(np.array(seamless, dtype=np.uint8), strength=2.8).save(norm_p)

        arr = np.array(seamless, dtype=np.int32)
        sat_blue = int(((arr[:, :, 2] > 160) & (arr[:, :, 2] - arr[:, :, 0] > 50) & (arr[:, :, 2] - arr[:, :, 1] > 35)).sum())
        reports[bg_name] = {
            "source": "i2i_codex" if raw_p.exists() else "procedural_fallback",
            "size": [1024, 1536],
            "saturated_blue_ratio": round(sat_blue / (1024 * 1536), 6),
        }
    return reports


def process_hud_and_cutin(hud_meta: dict):
    W, H = hud_meta["size"]
    raw_p = RAW_DIR / "hud_and_cutin_raw.png"
    ref_p = REFS_DIR / "hud_and_cutin_ref.png"
    src_p = raw_p if raw_p.exists() else ref_p
    img = Image.open(src_p).convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    arr = np.array(img, dtype=np.uint8)
    # Clamp any blue cast
    r, g, b = arr[:, :, 0].astype(np.int32), arr[:, :, 1].astype(np.int32), arr[:, :, 2].astype(np.int32)
    mask = (b - r > 35) & (b - g > 25)
    arr[:, :, 2][mask] = np.clip(g[mask] + 10, 0, 255).astype(np.uint8)

    cx0, cy0, cx1, cy1 = hud_meta["cutin_rect"]
    fx0, fy0, fx1, fy1 = hud_meta["hud_frame_rect"]

    cutin_img = Image.fromarray(arr[cy0:cy1, cx0:cx1], mode="RGB")
    frame_img = Image.fromarray(arr[fy0:fy1, fx0:fx1], mode="RGB")

    cutin_img.save(ASSETS_DIR / "boss_cutin.png")
    frame_img.save(ASSETS_DIR / "hud_frame.png")

    # Process AGY astrolabe mandala if available
    agy_p = RAW_DIR / "agy_astrolabe_mandala.png"
    if agy_p.exists():
        m_img = Image.open(agy_p).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)
        m_arr = np.array(m_img, dtype=np.float32)
        # Extract luminance/gold intensity as alpha for additive/alpha mandala overlay
        lum = (0.35 * m_arr[:, :, 0] + 0.50 * m_arr[:, :, 1] + 0.15 * m_arr[:, :, 2])
        yy, xx = np.mgrid[0:512, 0:512]
        rad = np.sqrt((xx - 256.0) ** 2 + (yy - 256.0) ** 2) / 248.0
        radial_fade = np.clip(1.0 - rad ** 3, 0.0, 1.0)
        alpha = np.clip((lum - 28.0) / 160.0, 0.0, 1.0) * radial_fade
        m_rgba = np.dstack([
            np.clip(m_arr[:, :, 0], 0, 255).astype(np.uint8),
            np.clip(m_arr[:, :, 1], 0, 255).astype(np.uint8),
            np.clip(np.minimum(m_arr[:, :, 2], m_arr[:, :, 1] * 0.9), 0, 255).astype(np.uint8),
            (alpha * 255.0).astype(np.uint8),
        ])
        Image.fromarray(m_rgba, mode="RGBA").save(ASSETS_DIR / "astrolabe_mandala.png")

    return {
        "source": "i2i_codex" if raw_p.exists() else "procedural_fallback",
        "agy_mandala_present": agy_p.exists(),
    }


def main():
    manifest = json.loads((ASSETS_DIR / "ref_manifest.json").read_text(encoding="utf-8"))
    ships_rep = process_joint_sheet(
        "ships_and_enemies",
        manifest["ships_and_enemies"],
        RAW_DIR / "ships_and_enemies_raw.png",
        REFS_DIR / "ships_and_enemies_ref.png",
    )
    boss_rep = process_joint_sheet(
        "boss_parts",
        manifest["boss_parts"],
        RAW_DIR / "boss_parts_raw.png",
        REFS_DIR / "boss_parts_ref.png",
    )
    bg_rep = process_stage_bgs()
    hud_rep = process_hud_and_cutin(manifest["hud_and_cutin"])

    audit = {
        "ships_and_enemies": ships_rep,
        "boss_parts": boss_rep,
        "stage_bgs": bg_rep,
        "hud_and_cutin": hud_rep,
    }
    audit_path = ASSETS_DIR / "audit_report.json"
    audit_path.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
