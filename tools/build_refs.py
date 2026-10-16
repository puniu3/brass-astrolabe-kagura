#!/usr/bin/env python3
"""
Deterministic Procedural Structure & 3D Blocking Reference Generator
Follows procedural-i2i & prerendered-i2i methodology:
- Joint sheets use pure flat #FF00FF magenta background + clean magenta gutters + thin inset slot frames.
- Complex mechanical silhouettes are drawn with crisp geometry, filled mass, and explicit dark inert recesses (#121014) for cores/muzzles/optics.
- 3D perspective stage blocking uses symbolic geometry and consistent world-space warm directional shading.
- Outputs public/assets/ref_manifest.json with exact cell rectangles, pivots, and socket coordinates.
"""

import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
REFS_DIR = ROOT / "refs"
ASSETS_DIR = ROOT / "public" / "assets"
REFS_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

MAGENTA = (255, 0, 255)
SLOT_BORDER = (90, 75, 55)  # Non-magenta thin slot frame (cropped out via inset slice)
INERT_RECESS = (16, 14, 18)  # Dark inert recess for engine-lit emissive sockets

# Palette for procedural structure refs (warm brass, bronze, obsidian, vermilion, jade, ivory — NO blue/pink/magenta)
BRASS_LIGHT = (224, 184, 96)
BRASS_MID = (182, 138, 62)
BRASS_DARK = (118, 84, 34)
OBSIDIAN = (36, 32, 30)
IRON_DARK = (58, 52, 48)
VERMILION = (196, 58, 42)
VERMILION_DARK = (128, 34, 24)
JADE = (68, 148, 108)
JADE_DARK = (38, 92, 66)
IVORY = (238, 228, 206)
PORCELAIN_SHADOW = (192, 180, 158)


def poly_mirror_x(cx, cy, pts):
    """Given points [(dx, dy), ...] for right side (dx >= 0), return full symmetric polygon around (cx, cy)."""
    right = [(cx + dx, cy + dy) for dx, dy in pts]
    left = [(cx - dx, cy + dy) for dx, dy in reversed(pts) if dx > 0]
    return right + left


def draw_symmetric_poly(draw, cx, cy, pts, fill, outline=BRASS_DARK, width=2):
    poly = [(cx + dx, cy + dy) for dx, dy in pts]
    draw.polygon(poly, fill=fill, outline=outline)
    poly_l = [(cx - dx, cy + dy) for dx, dy in pts]
    draw.polygon(poly_l, fill=fill, outline=outline)


def draw_ring(draw, cx, cy, r_outer, r_inner, fill, outline=BRASS_DARK, bg_fill=MAGENTA):
    draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=fill, outline=outline, width=2)
    if r_inner > 0:
        draw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=bg_fill, outline=outline, width=2)


def draw_gear_ring(draw, cx, cy, r_outer, r_inner, teeth, fill, tooth_len=10, tooth_w=0.35, bg_fill=MAGENTA):
    pts = []
    for i in range(teeth * 4):
        ang = (i / (teeth * 4)) * math.tau
        phase = i % 4
        r = r_outer + tooth_len if phase in (1, 2) else r_outer
        pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
    draw.polygon(pts, fill=fill, outline=BRASS_DARK)
    if r_inner > 0:
        draw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=bg_fill, outline=BRASS_DARK, width=2)


def build_ships_and_enemies_ref():
    W, H = 1536, 1024
    cols, rows = 4, 3
    cell_w, cell_h = W // cols, H // rows  # 384 x 341
    gutter = 14
    inset = 6

    img = Image.new("RGB", (W, H), MAGENTA)
    draw = ImageDraw.Draw(img)

    cells_meta = []
    names = [
        ("player_ship", "Player Craft: Shinkiro Gilded Astrolabe Fighter"),
        ("player_option", "Player Option: Octagonal Brass Incense Satellite"),
        ("enemy_scout_a", "Light Automaton A: Vermilion & Brass Swallow Drone"),
        ("enemy_scout_b", "Light Automaton B: Four-Blade Jade & Brass Spinner"),
        ("enemy_turret_med", "Medium Automaton: Hexagonal Tri-Cannon Bastion"),
        ("enemy_barge_med", "Medium Shrine Barge: Twin-Prong Lacquer Cruiser"),
        ("enemy_carrier_heavy", "Heavy Shrine Carrier: Layered Lamellar Gunship"),
        ("midboss_koumoku", "Midboss Core: Koumoku Four-Armed Brass Guardian"),
        ("relic_node", "Destructible Relic: Octagonal Jade & Brass Pylon"),
        ("item_medal", "Collectible Medal: Stamped Antique Gold Sun-Coin"),
        ("item_power", "Power Talisman: Ornate Vermilion & Gold Plaque"),
        ("item_bomb", "Bomb Relic: Carved Celadon Jade & Gold Crescent"),
    ]

    for idx, (key, label) in enumerate(names):
        c = idx % cols
        r = idx // cols
        x0 = c * cell_w + gutter
        y0 = r * cell_h + gutter
        x1 = (c + 1) * cell_w - gutter
        y1 = (r + 1) * cell_h - gutter
        cx = (x0 + x1) // 2
        cy = (y0 + y1) // 2

        # Thin slot frame (cropped out via inset during slicing)
        draw.rectangle([x0, y0, x1, y1], outline=SLOT_BORDER, width=2)

        emissive_sockets = []

        if key == "player_ship":
            # Twin forward brass prongs, swept winged astrolabe hull, vermilion inner plates, dark inert core
            draw_symmetric_poly(draw, cx, cy, [(12, -125), (34, -95), (38, -15), (14, 10)], BRASS_LIGHT)
            draw_symmetric_poly(draw, cx, cy, [(34, -55), (128, 15), (142, 65), (85, 82), (32, 48)], BRASS_MID)
            draw_symmetric_poly(draw, cx, cy, [(42, -30), (105, 22), (112, 52), (48, 38)], VERMILION)
            draw_symmetric_poly(draw, cx, cy, [(18, 35), (56, 98), (32, 118), (12, 88)], IRON_DARK)
            # Central fuselage & astrolabe ring
            draw.polygon(poly_mirror_x(cx, cy, [(0, -108), (24, -70), (30, 55), (16, 108), (0, 122)]), fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw_ring(draw, cx, cy - 5, 44, 28, BRASS_LIGHT, bg_fill=OBSIDIAN)
            # Inert recesses: central core + twin thruster nozzles + wingtip optics
            draw.ellipse([cx - 16, cy - 21, cx + 16, cy + 11], fill=INERT_RECESS, outline=BRASS_MID, width=2)
            draw.ellipse([cx - 32, cy + 88, cx - 14, cy + 106], fill=INERT_RECESS, outline=BRASS_MID)
            draw.ellipse([cx + 14, cy + 88, cx + 32, cy + 106], fill=INERT_RECESS, outline=BRASS_MID)
            emissive_sockets = [{"dx": 0, "dy": -5, "r": 16}, {"dx": -23, "dy": 97, "r": 9}, {"dx": 23, "dy": 97, "r": 9}]

        elif key == "player_option":
            draw_gear_ring(draw, cx, cy, 78, 0, 8, BRASS_MID, tooth_len=14)
            draw.regular_polygon((cx, cy, 64), 8, rotation=22.5, fill=VERMILION, outline=BRASS_LIGHT)
            draw.regular_polygon((cx, cy, 42), 8, rotation=0, fill=BRASS_LIGHT, outline=BRASS_DARK)
            draw.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill=INERT_RECESS, outline=BRASS_MID, width=2)
            emissive_sockets = [{"dx": 0, "dy": 0, "r": 22}]

        elif key == "enemy_scout_a":
            # Forward-pointing (downward in STG screen, drawn pointing DOWN) swallow drone
            draw_symmetric_poly(draw, cx, cy, [(0, 105), (28, 45), (110, -25), (125, -75), (45, -45), (18, -85), (0, -65)], BRASS_MID)
            draw_symmetric_poly(draw, cx, cy, [(12, 35), (86, -22), (92, -52), (24, -28)], VERMILION)
            draw.polygon(poly_mirror_x(cx, cy, [(0, 112), (20, 40), (16, -70), (0, -88)]), fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw.ellipse([cx - 15, cy - 15, cx + 15, cy + 15], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
            emissive_sockets = [{"dx": 0, "dy": 0, "r": 15}]

        elif key == "enemy_scout_b":
            # Four-blade shuriken automaton
            for k in range(4):
                ang = k * (math.pi / 2)
                c_a, s_a = math.cos(ang), math.sin(ang)
                blade = [(0, -28), (38, -42), (118, -12), (52, 26), (12, 18)]
                rot_blade = [(cx + x * c_a - y * s_a, cy + x * s_a + y * c_a) for x, y in blade]
                draw.polygon(rot_blade, fill=BRASS_LIGHT, outline=BRASS_DARK)
                inlay = [(22, -24), (82, -10), (42, 14)]
                rot_inlay = [(cx + x * c_a - y * s_a, cy + x * s_a + y * c_a) for x, y in inlay]
                draw.polygon(rot_inlay, fill=JADE, outline=BRASS_DARK)
            draw.regular_polygon((cx, cy, 46), 8, fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=INERT_RECESS, outline=BRASS_MID, width=2)
            emissive_sockets = [{"dx": 0, "dy": 0, "r": 20}]

        elif key == "enemy_turret_med":
            draw.regular_polygon((cx, cy, 122), 6, rotation=30, fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw.regular_polygon((cx, cy, 102), 6, rotation=30, fill=BRASS_MID, outline=BRASS_DARK)
            draw.regular_polygon((cx, cy, 74), 6, rotation=0, fill=VERMILION_DARK, outline=BRASS_LIGHT)
            # 3 cannon barrels pointing down-left, down, down-right
            for ang_deg in (60, 90, 120):
                ang = math.radians(ang_deg)
                bx = cx + math.cos(ang) * 95
                by = cy + math.sin(ang) * 95
                draw.line([cx, cy, bx, by], fill=IRON_DARK, width=24)
                draw.ellipse([bx - 11, by - 11, bx + 11, by + 11], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
                emissive_sockets.append({"dx": round(bx - cx), "dy": round(by - cy), "r": 11})
            draw.ellipse([cx - 28, cy - 28, cx + 28, cy + 28], fill=INERT_RECESS, outline=BRASS_LIGHT, width=3)
            emissive_sockets.append({"dx": 0, "dy": 0, "r": 28})

        elif key == "enemy_barge_med":
            # Catamaran shrine barge
            draw_symmetric_poly(draw, cx, cy, [(48, -110), (118, -82), (126, 78), (78, 118), (44, 92)], BRASS_MID)
            draw_symmetric_poly(draw, cx, cy, [(58, -82), (104, -62), (108, 62), (66, 88)], VERMILION)
            draw.rectangle([cx - 62, cy - 58, cx + 62, cy + 54], fill=OBSIDIAN, outline=BRASS_LIGHT, width=3)
            draw.rectangle([cx - 46, cy - 38, cx + 46, cy + 34], fill=JADE_DARK, outline=BRASS_MID, width=2)
            for dx in (-82, 0, 82):
                draw.ellipse([cx + dx - 14, cy + 68 - 14, cx + dx + 14, cy + 68 + 14], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
                emissive_sockets.append({"dx": dx, "dy": 68, "r": 14})

        elif key == "enemy_carrier_heavy":
            # Broad heavy samurai-lamellar carrier
            draw_symmetric_poly(draw, cx, cy, [(0, -118), (95, -96), (148, -28), (138, 86), (68, 118), (0, 98)], OBSIDIAN)
            for strip_y in (-72, -32, 8, 48):
                draw_symmetric_poly(draw, cx, cy, [(14, strip_y), (124, strip_y + 12), (118, strip_y + 34), (14, strip_y + 24)], BRASS_MID)
            draw.polygon(poly_mirror_x(cx, cy, [(0, -98), (44, -64), (52, 68), (0, 96)]), fill=VERMILION, outline=BRASS_LIGHT)
            draw_ring(draw, cx, cy - 8, 38, 20, BRASS_LIGHT, bg_fill=INERT_RECESS)
            for dx, dy in [(-88, 68), (88, 68), (0, -8)]:
                r = 20 if dx == 0 else 15
                draw.ellipse([cx + dx - r, cy + dy - r, cx + dx + r, cy + dy + r], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
                emissive_sockets.append({"dx": dx, "dy": dy, "r": r})

        elif key == "midboss_koumoku":
            # Fierce 4-armed brass guardian chassis + mask
            draw_gear_ring(draw, cx, cy, 118, 0, 12, BRASS_DARK, tooth_len=10)
            draw_symmetric_poly(draw, cx, cy, [(38, -85), (136, -58), (148, 35), (108, 105), (58, 88)], BRASS_LIGHT)
            draw_symmetric_poly(draw, cx, cy, [(52, -48), (120, -24), (122, 42), (76, 72)], JADE)
            # Central guardian mask face
            draw.polygon(poly_mirror_x(cx, cy, [(0, -86), (56, -62), (64, 24), (38, 86), (0, 102)]), fill=IVORY, outline=BRASS_DARK)
            draw.polygon(poly_mirror_x(cx, cy, [(0, -86), (48, -66), (32, -34), (0, -42)]), fill=VERMILION, outline=BRASS_DARK)
            # Dark inert eye sockets & forehead orb & twin shoulder bores
            for dx, dy, r in [(-24, -8, 11), (24, -8, 11), (0, -52, 13), (-96, 62, 14), (96, 62, 14)]:
                draw.ellipse([cx + dx - r, cy + dy - r, cx + dx + r, cy + dy + r], fill=INERT_RECESS, outline=BRASS_DARK, width=2)
                emissive_sockets.append({"dx": dx, "dy": dy, "r": r})

        elif key == "relic_node":
            draw.regular_polygon((cx, cy, 98), 8, rotation=22.5, fill=BRASS_LIGHT, outline=BRASS_DARK)
            draw.regular_polygon((cx, cy, 74), 8, rotation=0, fill=JADE, outline=BRASS_DARK)
            draw.regular_polygon((cx, cy, 42), 4, rotation=45, fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
            emissive_sockets = [{"dx": 0, "dy": 0, "r": 18}]

        elif key == "item_medal":
            # Antique octagonal gold coin with central square hole filled with darkobsidian (not hollow magenta, so medal is a solid gleaming coin)
            draw.regular_polygon((cx, cy, 92), 8, rotation=22.5, fill=BRASS_LIGHT, outline=BRASS_DARK)
            draw.ellipse([cx - 72, cy - 72, cx + 72, cy + 72], fill=BRASS_MID, outline=BRASS_DARK, width=3)
            draw.rectangle([cx - 24, cy - 24, cx + 24, cy + 24], fill=OBSIDIAN, outline=BRASS_LIGHT, width=3)

        elif key == "item_power":
            # Vermilion & gold hexagonal ofuda plaque
            pts = poly_mirror_x(cx, cy, [(0, -102), (64, -68), (64, 78), (38, 104), (0, 104)])
            draw.polygon(pts, fill=VERMILION, outline=BRASS_LIGHT)
            draw.rectangle([cx - 42, cy - 68, cx + 42, cy + 68], fill=IVORY, outline=BRASS_DARK, width=3)
            draw.regular_polygon((cx, cy, 28), 6, fill=BRASS_MID, outline=BRASS_DARK)

        elif key == "item_bomb":
            # Jade & gold crescent relic medallion
            draw.regular_polygon((cx, cy, 96), 8, fill=BRASS_DARK, outline=BRASS_LIGHT)
            draw.ellipse([cx - 78, cy - 78, cx + 78, cy + 78], fill=JADE, outline=BRASS_LIGHT, width=3)
            draw.ellipse([cx - 34, cy - 42, cx + 52, cy + 42], fill=OBSIDIAN, outline=BRASS_LIGHT, width=2)
            draw.ellipse([cx - 42, cy - 18, cx - 10, cy + 14], fill=BRASS_LIGHT, outline=BRASS_DARK)

        cells_meta.append({
            "key": key,
            "label": label,
            "rect": [x0 + inset, y0 + inset, x1 - inset, y1 - inset],
            "slot_rect": [x0, y0, x1, y1],
            "center": [cx, cy],
            "emissive_sockets": emissive_sockets,
        })

    out_path = REFS_DIR / "ships_and_enemies_ref.png"
    img.save(out_path)
    return {"sheet": "ships_and_enemies", "size": [W, H], "cells": cells_meta}


def build_boss_parts_ref():
    """
    8-cell joint sheet (4x2) for the Colossal Multi-Part Boss 'Amaterasu-Automaton':
    Cell 0: Hero Assembly Anchor (shows full assembled relationship)
    Cell 1: Central Sanctum Core Chassis
    Cell 2: Ceremonial White Porcelain & Gold Kintsugi Noh Sun-Mask
    Cell 3: Hollow Astrolabe Outer Ring (with #FF00FF interior so keyer extracts true annulus!)
    Cell 4: Primary Mechanical Wing Pinion (Right side; instanced & mirrored for Left)
    Cell 5: Secondary Lower Wing Blade (Right side; instanced & mirrored for Left)
    Cell 6: Heavy Shoulder Twin-Cannon Turret (Right side; instanced & mirrored for Left)
    Cell 7: Ceremonial Tail Pendulum Halberd
    """
    W, H = 1536, 1024
    cols, rows = 4, 2
    cell_w, cell_h = W // cols, H // rows  # 384 x 512
    gutter = 14
    inset = 6

    img = Image.new("RGB", (W, H), MAGENTA)
    draw = ImageDraw.Draw(img)

    names = [
        ("boss_hero_anchor", "Assembled Hero Reference of Amaterasu-Automaton"),
        ("boss_core_chassis", "Central Octagonal Obsidian & Brass Sanctum Chassis"),
        ("boss_mask_plate", "White Porcelain & Gold Kintsugi Sun-Deity Mask Plate"),
        ("boss_astrolabe_ring", "Hollow Engraved Brass Astrolabe Ring"),
        ("boss_wing_primary", "Right Primary Mechanical Feather-Wing Pinion"),
        ("boss_wing_secondary", "Right Secondary Jade & Brass Lower Fin"),
        ("boss_shoulder_turret", "Right Heavy Twin-Barrel Rotary Cannon Pauldron"),
        ("boss_tail_pendulum", "Central Ceremonial Pendulum Spear-Tail"),
    ]

    cells_meta = []

    for idx, (key, label) in enumerate(names):
        c = idx % cols
        r = idx // cols
        x0 = c * cell_w + gutter
        y0 = r * cell_h + gutter
        x1 = (c + 1) * cell_w - gutter
        y1 = (r + 1) * cell_h - gutter
        cx = (x0 + x1) // 2
        cy = (y0 + y1) // 2

        draw.rectangle([x0, y0, x1, y1], outline=SLOT_BORDER, width=2)
        emissive_sockets = []
        pivot = [0, 0]

        if key == "boss_hero_anchor":
            # Miniature complete assembly showing shared materials
            draw_ring(draw, cx, cy - 10, 142, 114, BRASS_MID, bg_fill=MAGENTA)
            draw_symmetric_poly(draw, cx, cy - 10, [(40, -60), (156, -120), (164, 10), (70, 50)], BRASS_LIGHT)
            draw_symmetric_poly(draw, cx, cy - 10, [(35, 30), (132, 65), (112, 130), (40, 85)], JADE)
            draw.polygon(poly_mirror_x(cx, cy, [(0, 60), (22, 95), (14, 195), (0, 215)]), fill=BRASS_MID, outline=BRASS_DARK)
            draw.regular_polygon((cx, cy - 10, 78), 8, fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw.polygon(poly_mirror_x(cx, cy - 10, [(0, -68), (44, -46), (48, 18), (26, 56), (0, 68)]), fill=IVORY, outline=BRASS_DARK)
            draw.ellipse([cx - 18, cy - 28, cx + 18, cy + 8], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)

        elif key == "boss_core_chassis":
            # Large octagonal mechanical sanctum core frame
            draw_gear_ring(draw, cx, cy, 144, 0, 16, BRASS_DARK, tooth_len=10)
            draw.regular_polygon((cx, cy, 134), 8, rotation=22.5, fill=OBSIDIAN, outline=BRASS_LIGHT)
            draw.regular_polygon((cx, cy, 108), 8, rotation=0, fill=VERMILION_DARK, outline=BRASS_MID)
            draw.regular_polygon((cx, cy, 82), 8, rotation=22.5, fill=IRON_DARK, outline=BRASS_LIGHT)
            # Central furnace core & 4 cardinal sockets
            draw.ellipse([cx - 42, cy - 42, cx + 42, cy + 42], fill=INERT_RECESS, outline=BRASS_LIGHT, width=3)
            emissive_sockets.append({"dx": 0, "dy": 0, "r": 42})
            for ang_deg in (0, 90, 180, 270):
                ang = math.radians(ang_deg)
                sx, sy = round(math.cos(ang) * 96), round(math.sin(ang) * 96)
                draw.ellipse([cx + sx - 14, cy + sy - 14, cx + sx + 14, cy + sy + 14], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
                emissive_sockets.append({"dx": sx, "dy": sy, "r": 14})

        elif key == "boss_mask_plate":
            # Ornate sun-crown + white porcelain Noh mask with kintsugi seams & inert eye slits
            # Sun-ray crown
            for k in range(-4, 5):
                ang = math.radians(-90 + k * 18)
                x_in, y_in = cx + math.cos(ang) * 88, cy - 20 + math.sin(ang) * 88
                x_out, y_out = cx + math.cos(ang) * 148, cy - 20 + math.sin(ang) * 148
                draw.line([x_in, y_in, x_out, y_out], fill=BRASS_LIGHT, width=12)
            draw.polygon(poly_mirror_x(cx, cy, [(0, -124), (86, -84), (96, 18), (68, 114), (0, 146)]), fill=IVORY, outline=BRASS_LIGHT)
            # Cheek vermilion markings & gold kintsugi lines
            draw_symmetric_poly(draw, cx, cy, [(38, 18), (76, 8), (66, 56), (32, 48)], VERMILION)
            # Inert eye slits & third-eye recess
            draw_symmetric_poly(draw, cx, cy, [(16, -24), (62, -32), (56, -10), (18, -8)], INERT_RECESS, outline=BRASS_DARK)
            draw.ellipse([cx - 18, cy - 78, cx + 18, cy - 42], fill=INERT_RECESS, outline=BRASS_LIGHT, width=3)
            emissive_sockets = [{"dx": 0, "dy": -60, "r": 18}, {"dx": -38, "dy": -20, "r": 14}, {"dx": 38, "dy": -20, "r": 14}]

        elif key == "boss_astrolabe_ring":
            # Hollow ring! Interior is MAGENTA so keyer makes it truly transparent inside
            draw_gear_ring(draw, cx, cy, 148, 104, 24, BRASS_LIGHT, tooth_len=8, bg_fill=MAGENTA)
            draw_ring(draw, cx, cy, 142, 112, BRASS_MID, bg_fill=MAGENTA)
            for k in range(8):
                ang = k * (math.pi / 4)
                rx, ry = round(math.cos(ang) * 127), round(math.sin(ang) * 127)
                draw.ellipse([cx + rx - 10, cy + ry - 10, cx + rx + 10, cy + ry + 10], fill=INERT_RECESS, outline=BRASS_DARK, width=2)
                emissive_sockets.append({"dx": rx, "dy": ry, "r": 10})

        elif key == "boss_wing_primary":
            # Right wing pinion: hinge on left side of cell, sweeping blades to the right and down
            hx, hy = cx - 110, cy - 40
            pivot = [hx - cx, hy - cy]
            # Upper mechanical shoulder beam
            draw.polygon([(hx, hy - 35), (cx + 135, cy - 175), (cx + 150, cy - 110), (hx + 25, hy + 30)], fill=OBSIDIAN, outline=BRASS_LIGHT)
            # 5 layered brass & vermilion feather blades
            blade_tips = [
                (cx + 152, cy - 135, BRASS_LIGHT),
                (cx + 156, cy - 55, VERMILION),
                (cx + 148, cy + 28, BRASS_MID),
                (cx + 126, cy + 108, VERMILION),
                (cx + 88, cy + 178, BRASS_LIGHT),
            ]
            for i, (tx, ty, col) in enumerate(blade_tips):
                bx = hx + 15 + i * 14
                by = hy - 10 + i * 26
                draw.polygon([(bx, by - 22), (tx, ty - 18), (tx - 12, ty + 24), (bx - 10, by + 26)], fill=col, outline=BRASS_DARK)
            # Hinge socket
            draw.ellipse([hx - 28, hy - 28, hx + 28, hy + 28], fill=BRASS_LIGHT, outline=BRASS_DARK, width=3)
            draw.ellipse([hx - 14, hy - 14, hx + 14, hy + 14], fill=INERT_RECESS, outline=BRASS_DARK, width=2)
            emissive_sockets.append({"dx": hx - cx, "dy": hy - cy, "r": 14})

        elif key == "boss_wing_secondary":
            # Right lower jade & brass stabilizer fin
            hx, hy = cx - 95, cy - 80
            pivot = [hx - cx, hy - cy]
            draw.polygon([(hx, hy), (cx + 128, cy - 45), (cx + 142, cy + 65), (cx + 45, cy + 175), (hx - 25, cy + 95)], fill=BRASS_MID, outline=BRASS_DARK)
            draw.polygon([(hx + 18, hy + 22), (cx + 104, cy - 18), (cx + 112, cy + 52), (cx + 38, cy + 135), (hx, cy + 68)], fill=JADE, outline=BRASS_LIGHT)
            draw.ellipse([hx - 24, hy - 24, hx + 24, hy + 24], fill=OBSIDIAN, outline=BRASS_LIGHT, width=3)
            draw.ellipse([cx + 42 - 16, cy + 52 - 16, cx + 42 + 16, cy + 52 + 16], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
            emissive_sockets.append({"dx": 42, "dy": 52, "r": 16})

        elif key == "boss_shoulder_turret":
            # Heavy twin-barrel rotary cannon pauldron (pointing down)
            pivot = [0, -70]
            # Twin cannon barrels
            for bx_off in (-38, 38):
                draw.rectangle([cx + bx_off - 22, cy - 20, cx + bx_off + 22, cy + 158], fill=IRON_DARK, outline=BRASS_LIGHT, width=2)
                draw.rectangle([cx + bx_off - 26, cy + 95, cx + bx_off + 26, cy + 135], fill=BRASS_MID, outline=BRASS_DARK, width=2)
                draw.ellipse([cx + bx_off - 16, cy + 142, cx + bx_off + 16, cy + 174], fill=INERT_RECESS, outline=BRASS_LIGHT, width=2)
                emissive_sockets.append({"dx": bx_off, "dy": 158, "r": 16})
            # Armored turret housing
            draw.polygon(poly_mirror_x(cx, cy, [(0, -148), (96, -108), (112, 12), (76, 68), (0, 82)]), fill=BRASS_LIGHT, outline=BRASS_DARK)
            draw.polygon(poly_mirror_x(cx, cy, [(0, -118), (68, -86), (78, 0), (48, 44), (0, 54)]), fill=VERMILION, outline=BRASS_LIGHT)
            draw.ellipse([cx - 24, cy - 70 - 24, cx + 24, cy - 70 + 24], fill=INERT_RECESS, outline=BRASS_LIGHT, width=3)
            emissive_sockets.append({"dx": 0, "dy": -70, "r": 24})

        elif key == "boss_tail_pendulum":
            # Ceremonial pendulum halberd tail
            pivot = [0, -165]
            draw.rectangle([cx - 18, cy - 185, cx + 18, cy + 95], fill=OBSIDIAN, outline=BRASS_LIGHT, width=2)
            draw_symmetric_poly(draw, cx, cy, [(18, -110), (92, -65), (74, 15), (18, 35)], BRASS_MID)
            draw_symmetric_poly(draw, cx, cy, [(18, -82), (68, -50), (56, 2), (18, 16)], JADE)
            # Lower halberd spearhead & pendulum gear
            draw_gear_ring(draw, cx, cy + 95, 68, 0, 12, BRASS_LIGHT, tooth_len=8)
            draw.polygon(poly_mirror_x(cx, cy, [(0, 40), (46, 95), (28, 175), (0, 212)]), fill=BRASS_LIGHT, outline=BRASS_DARK)
            draw.ellipse([cx - 22, cy + 95 - 22, cx + 22, cy + 95 + 22], fill=INERT_RECESS, outline=BRASS_DARK, width=2)
            emissive_sockets.append({"dx": 0, "dy": 95, "r": 22})

        cells_meta.append({
            "key": key,
            "label": label,
            "rect": [x0 + inset, y0 + inset, x1 - inset, y1 - inset],
            "slot_rect": [x0, y0, x1, y1],
            "center": [cx, cy],
            "pivot": pivot,
            "emissive_sockets": emissive_sockets,
        })

    out_path = REFS_DIR / "boss_parts_ref.png"
    img.save(out_path)
    return {"sheet": "boss_parts", "size": [W, H], "cells": cells_meta}


def build_stage_bg_refs():
    """
    Build two 1024x1536 vertical 3D-blocked architectural composition references
    following prerendered-i2i:
    1. stage_bg_abyss_ref.png: Subterranean obsidian & brass aqueduct canyon with warm amber magma fissures and sunken clockwork gears.
    2. stage_bg_sanctum_ref.png: Grand gilded astrolabe sanctum floor with concentric celestial rings and vermilion bridges.
    """
    W, H = 1024, 1536

    # 1. Abyss Aqueduct Canyon
    img1 = Image.new("RGB", (W, H), (24, 18, 16))
    d1 = ImageDraw.Draw(img1)
    # Warm magma rivers at the bottom of the chasm
    for y in range(0, H, 8):
        x_wave = int(math.sin(y * 0.006) * 140)
        d1.ellipse([W // 2 + x_wave - 110, y - 20, W // 2 + x_wave + 110, y + 20], fill=(168, 68, 24))
        d1.ellipse([W // 2 + x_wave - 55, y - 10, W // 2 + x_wave + 55, y + 10], fill=(232, 148, 48))

    # Giant sunken brass gears in the canyon depths
    for gx, gy, gr in [(220, 360, 240), (820, 780, 280), (260, 1220, 250)]:
        draw_gear_ring(d1, gx, gy, gr, gr - 75, 18, (88, 64, 34), tooth_len=22, bg_fill=(32, 24, 20))

    # Stepped obsidian canyon walls (left and right terraces)
    for step, (inset_w, col) in enumerate([(340, (44, 36, 32)), (240, (62, 50, 42)), (145, (86, 68, 52))]):
        pts_l = []
        pts_r = []
        for y in range(0, H + 64, 64):
            jag = int(math.sin(y * 0.012 + step) * 28)
            pts_l.append((inset_w + jag, y))
            pts_r.append((W - inset_w + jag, y))
        d1.polygon([(0, 0)] + pts_l + [(0, H)], fill=col, outline=(120, 92, 54))
        d1.polygon([(W, 0)] + pts_r + [(W, H)], fill=col, outline=(120, 92, 54))

    # Gilded aqueduct bridges spanning across the canyon at intervals
    for by in (260, 760, 1260):
        d1.rectangle([0, by - 58, W, by + 58], fill=(112, 84, 42), outline=BRASS_LIGHT, width=4)
        d1.rectangle([0, by - 36, W, by + 36], fill=VERMILION_DARK, outline=BRASS_MID, width=2)
        for arch_x in range(128, W, 192):
            d1.regular_polygon((arch_x, by, 32), 8, fill=BRASS_LIGHT, outline=OBSIDIAN)

    img1.save(REFS_DIR / "stage_bg_abyss_ref.png")

    # 2. Sanctum Observatory Floor (Boss Phase 2 Crossfade target)
    img2 = Image.new("RGB", (W, H), (28, 24, 22))
    d2 = ImageDraw.Draw(img2)
    # Coffered obsidian & jade temple floor tiles
    tile = 128
    for ty in range(0, H, tile):
        for tx in range(0, W, tile):
            d2.rectangle([tx + 4, ty + 4, tx + tile - 4, ty + tile - 4], fill=(42, 36, 32), outline=(92, 72, 42), width=2)
            d2.regular_polygon((tx + tile // 2, ty + tile // 2, 36), 8, fill=(36, 64, 48), outline=(120, 96, 52))

    # Colossal concentric astrolabe rings & zodiac mandala in the center
    for cy_ring in (384, 1152):
        draw_gear_ring(d2, W // 2, cy_ring, 420, 340, 24, (132, 98, 46), tooth_len=18, bg_fill=(34, 28, 24))
        draw_ring(d2, W // 2, cy_ring, 290, 210, VERMILION_DARK, outline=BRASS_LIGHT, bg_fill=(28, 24, 22))
        draw_gear_ring(d2, W // 2, cy_ring, 175, 85, 16, BRASS_MID, tooth_len=12, bg_fill=(22, 18, 16))
        for k in range(8):
            ang = k * (math.pi / 4)
            x2 = W // 2 + math.cos(ang) * 420
            y2 = cy_ring + math.sin(ang) * 420
            d2.line([W // 2, cy_ring, x2, y2], fill=BRASS_LIGHT, width=6)

    # Vertical ceremonial causeway rails
    d2.rectangle([64, 0, 148, H], fill=BRASS_MID, outline=BRASS_LIGHT, width=3)
    d2.rectangle([W - 148, 0, W - 64, H], fill=BRASS_MID, outline=BRASS_LIGHT, width=3)
    img2.save(REFS_DIR / "stage_bg_sanctum_ref.png")


def build_hud_and_cutin_ref():
    """
    Spec-first slot reference (1536x1024):
    - Left slot (x: 40..740, y: 40..984): Boss Cut-in Portrait ('Amaterasu-Automaton' porcelain sun-deity mask & golden clockwork halo, >700px scale for painterly & metallic relief richness).
    - Right slot (x: 780..1496, y: 40..984): Ornamental antique brass & dark obsidian lacquer frame plaque for HUD chrome (zero text, zero numbers).
    """
    W, H = 1536, 1024
    img = Image.new("RGB", (W, H), (20, 16, 14))
    d = ImageDraw.Draw(img)

    # Left Slot: High-res Boss Cut-In Portrait Blocking
    d.rectangle([40, 40, 740, 984], fill=(32, 22, 18), outline=BRASS_LIGHT, width=6)
    pcx, pcy = 390, 490
    # Grand radial clockwork sun-halo behind the portrait
    draw_gear_ring(d, pcx, pcy - 30, 310, 235, 24, BRASS_MID, tooth_len=18, bg_fill=(44, 28, 22))
    for k in range(16):
        ang = k * (math.tau / 16)
        d.line([pcx + math.cos(ang) * 180, pcy - 30 + math.sin(ang) * 180,
                pcx + math.cos(ang) * 335, pcy - 30 + math.sin(ang) * 335], fill=BRASS_LIGHT, width=8)
    # Armored kimono-mecha collar & shoulder pauldrons
    draw_symmetric_poly(d, pcx, pcy, [(65, 95), (315, 165), (325, 465), (0, 465)], OBSIDIAN, outline=BRASS_LIGHT)
    draw_symmetric_poly(d, pcx, pcy, [(45, 115), (235, 185), (215, 465), (0, 465)], VERMILION, outline=BRASS_LIGHT)
    draw_symmetric_poly(d, pcx, pcy, [(20, 135), (125, 195), (95, 465), (0, 465)], JADE_DARK, outline=BRASS_MID)
    # Elaborate brass crown headdress
    draw_symmetric_poly(d, pcx, pcy - 30, [(0, -310), (145, -245), (175, -110), (95, -75)], BRASS_LIGHT, outline=BRASS_DARK)
    # Serene white porcelain Noh mask face
    d.polygon(poly_mirror_x(pcx, pcy, [(0, -185), (125, -135), (138, 10), (96, 128), (0, 168)]), fill=IVORY, outline=BRASS_LIGHT)
    # Subtle facial structure cues (nose bridge, serene lips, vermilion cheek clasps)
    d.polygon(poly_mirror_x(pcx, pcy, [(0, -65), (22, 20), (0, 32)]), fill=PORCELAIN_SHADOW)
    d.polygon(poly_mirror_x(pcx, pcy, [(0, 68), (36, 76), (22, 92), (0, 88)]), fill=VERMILION)
    draw_symmetric_poly(d, pcx, pcy, [(28, -52), (92, -62), (82, -32), (32, -28)], INERT_RECESS, outline=BRASS_DARK)
    d.ellipse([pcx - 24, pcy - 142, pcx + 24, pcy - 94], fill=JADE, outline=BRASS_LIGHT, width=3)

    # Right Slot: Ornamental Brass & Lacquer HUD Chrome Frame Plaque (flat lighting, empty slate interior)
    rx0, ry0, rx1, ry1 = 780, 40, 1496, 984
    d.rectangle([rx0, ry0, rx1, ry1], fill=BRASS_MID, outline=BRASS_LIGHT, width=6)
    d.rectangle([rx0 + 28, ry0 + 28, rx1 - 28, ry1 - 28], fill=VERMILION_DARK, outline=BRASS_LIGHT, width=4)
    d.rectangle([rx0 + 52, ry0 + 52, rx1 - 52, ry1 - 52], fill=OBSIDIAN, outline=BRASS_MID, width=4)
    # Corner astrolabe medallions
    for mcx, mcy in [(rx0 + 52, ry0 + 52), (rx1 - 52, ry0 + 52), (rx0 + 52, ry1 - 52), (rx1 - 52, ry1 - 52)]:
        draw_gear_ring(d, mcx, mcy, 46, 0, 12, BRASS_LIGHT, tooth_len=6)
        d.ellipse([mcx - 26, mcy - 26, mcx + 26, mcy + 26], fill=JADE, outline=BRASS_DARK, width=2)
    # Horizontal divider bars for modular UI slicing
    for div_y in (280, 520, 760):
        d.rectangle([rx0 + 44, div_y - 14, rx1 - 44, div_y + 14], fill=BRASS_LIGHT, outline=BRASS_DARK, width=2)

    img.save(REFS_DIR / "hud_and_cutin_ref.png")
    return {
        "sheet": "hud_and_cutin",
        "size": [W, H],
        "cutin_rect": [48, 48, 732, 976],
        "hud_frame_rect": [780, 40, 1496, 984],
    }


def main():
    ships_meta = build_ships_and_enemies_ref()
    boss_meta = build_boss_parts_ref()
    build_stage_bg_refs()
    hud_meta = build_hud_and_cutin_ref()

    manifest = {
        "ships_and_enemies": ships_meta,
        "boss_parts": boss_meta,
        "hud_and_cutin": hud_meta,
        "stage_bgs": {
            "abyss": {"size": [1024, 1536], "ref": "refs/stage_bg_abyss_ref.png"},
            "sanctum": {"size": [1024, 1536], "ref": "refs/stage_bg_sanctum_ref.png"},
        },
    }
    manifest_path = ASSETS_DIR / "ref_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Generated all procedural i2i references in {REFS_DIR} and {manifest_path}")


if __name__ == "__main__":
    main()
