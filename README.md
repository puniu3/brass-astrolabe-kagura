# 真鍮天球のカラクリ神楽 — Kagura of the Brass Astrolabe

**Live Visual Demo**: https://puniu3.github.io/brass-astrolabe-kagura/

WebGL2 4パスHDRコンポジタと構造制御i2i（`procedural-i2i` / `prerendered-i2i`）パイプラインによる縦スクロール弾幕STGビジュアルデモ。

## 特長
- **Procedural-i2i & Prerendered-i2i アセットパイプライン**:
  - Python ([tools/build_refs.py](tools/build_refs.py)) による決定論的な構造ステンシル・3D空間ブロッキング設計図（`refs/`）の生成
  - 参照条件付きi2i生成と4段階マゼンタKeyer・Sobel法線マップ・発光ソケット分離 ([tools/keyer_and_normals.py](tools/keyer_and_normals.py))
  - マゼンタフリンジ比率 `0.000`・高彩度青比率 `0.000` を [public/assets/audit_report.json](public/assets/audit_report.json) で自動検証
- **WebGL2 4-Pass HDR Renderer** ([src/render/webgl_compositor.js](src/render/webgl_compositor.js)):
  - 法線マップ＋動的ポイントライト16灯によるプリレンダ背景のリアルタイム陰影とスペルカード遷移クロスフェード
  - 11パーツ階層ボスリグ（[src/render/boss_rig.js](src/render/boss_rig.js)）の独立砲塔旋回・砲身リコイル・装甲開帳アニメーション
  - 単一ドローコールGPUインスタンシングによるSDF弾幕・曲線リボンレーザー・天球儀結界リング描画

## 操作方法
- **タッチ操作 (iPad / タブレット)**: プレイフィールド内の任意の位置をスライドして **1:1 相対移動**（自機が指で隠れません）。右下の `結界発動 [X]` ボタンまたは2本指タップで結界発動。
- **キーボード**: `WASD` / 矢印キーで移動、`Shift` で低速集中照射、`X` / `Space` で結界発動、`1`〜`5` キー（または右サイドバー上部の `SCENE 1–5` ボタン）で各場面へ即時切替。
