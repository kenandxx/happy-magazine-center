# Happy Magazine Center

日本のアイドル専門誌・グラビアムック・週刊誌＆青年コミック誌（ポスター／クリアファイル／DVD付録あり）・アイドル表紙の女性誌・写真集・**2027年カレンダー**・**🔞 アダルト・R18**の**発売日（今月〜3ヶ月先）**、**関連写真（表紙・限定表紙・特典絵柄・公式先行カット）**、**ストア別限定特典（セブンネット / 楽天ブックス / HMV&BOOKS / TSUTAYA / Amazon）**、**公式SNS＆カバーガール宣伝ポスト**をスマホからワンタップでチェックできるモバイルファースト情報センターです。

- 🌐 **スマホ公開URL（GitHub Pages）**：https://kenandxx.github.io/happy-magazine-center/

## 主な機能（v1.2）

- **🏆「買わなきゃ損！名作・殿堂（2024〜2026）」(`#tab-masterpieces`) ＋多店舗ライブ在庫チェック（`scripts/masterpieces-checker.mjs`）**：2024年1月〜現在までのオリコン年間TOP写真集・10刷重版グラビア・🔞R18代表作・伝説の雑誌バックナンバー **厳選38作品** を専用コーナーに収録。すでに持っている本は **1タップ「✅ 持ってる（消す）」** で即非表示（誤操作も6秒フローティング **[↩ 戻す]** で即復帰）、迷う本は **「🤔 検討する」** でマーク棚に連動保存。さらに毎朝07:00の自動更新で **楽天ブックス・セブンネット・丸善ジュンク堂の新品在庫状況（✅ 新品在庫あり／⚠️ 品薄・一部ストアのみ／🔴 新品完売・中古/プレミア）** をライブ判定し、品薄・完売作には **駿河屋・メルカリ中古リンク** も自動表示します。
- **🌐 APIキー・ログイン不要「5系統」多サイト毎朝07:00自動収集（`scripts/multisite-ingestor.mjs` ＋ `scripts/prtimes-ingestor.mjs`）**：楽天Webサービス障害やAPIキー未設定でも、毎朝07:00 JSTに **①PR TIMES 15出版社公式RSS / ②版元ドットコム10主要版元（彩文館・ジーウォーク・ジーオーティー・双葉社・竹書房・ワニブックス・講談社・集英社・光文社・秋田書店）近刊RSS＋openBDバッチ / ③セブンネット限定表紙・サイン本・ポストカード生抽出（JSON-LD） / ④HMV&BOOKS Shift_JIS RSS / ⑤B.L.T.web公式RSS** の5系統を自動巡回し、新刊・限定特典・公式書影を自動取り込みします（任意で2026年版楽天OpenAPIも併用可能）。
- **📲 スマホ共有シート「Amazonアプリ短縮URL（`amzn.asia`）＆商品URL → 1タップ自動展開＆即スコア投入」**：Amazonアプリの短縮URL（`https://amzn.asia/d/...`）を貼るだけで自動展開し、openBDから公式書影・発売日・定価を取得＆その場で **売り切れ警戒スコア（S/A/B）をライブ判定** して即投入できます（iPhoneショートカット・Android PWA Web Share Target・ブックマークレット対応）。
- **📚 実在145新刊＋38殿堂名作・324オファー・検証済み書影242枚（うち `🔞 R18` 48新刊＋7名作・`🆕 自動発見` 38作品）**：全242枚の画像をライブHTTP200・ISBN-10チェックサムまで自動検証。
- **💖 推しコーナー＆1タップ人気タレント登録（85名超）＋👑 マイVIP超人気枠 (+30pt)＋🚀 3段階推し加点ブースト**：ボトムナビ「💖 推し・棚」からアイドル・グラビア・R18女優をタップするだけで推し登録＆VIP昇格。「💖 推しのみ」「🆕 自動発見」トグルで一覧を瞬時絞り込み可能。
- **🔥「早め予約・争奪戦レーダー」(`#tab-urgent`)**：直近〜今後2〜3ヶ月（-14日〜+100日）を透明な7要素スコアリング（`src/scarcity-score.js`）で **🔴 Sランク（即予約推奨）・🟠 Aランク（早め確保）・🟡 Bランク（注目枠）** に自動判定。
- **👈 左手ワンハンド最適化・🏷 表紙・特典別マーク棚・🛡️ 書影＆ISBN整合性ガード・💰 月別予算メーター・📅 一括 `.ics` 出力・💾 JSONバックアップ復元・🚃 R18電車モード・🏪 ノイズゼロ表示（非Amazon無特典 0件）**

## 楽天ブックスOpenAPI（2026年版）の任意追加

未設定でも **キー不要5系統（PR TIMES 15社＋版元ドットコム10社＋セブンネット＋HMV＋B.L.T.web）＋名作ライブ在庫チェック** が毎朝07:00に完全稼働します。さらに楽天ブックス限定特典も毎朝自動収集したい場合は、アプリ内「💖 推し・棚 → ⚡ 取込・保存」の3ステップガイドに沿って GitHub Actions Secrets に `RAKUTEN_APP_ID` と `RAKUTEN_ACCESS_KEY` を登録できます。

## 構成

- `index.html` / `manifest.json`（Web Share Target対応）/ `assets/icon.svg`：モバイルファースト・6タブナビ・PWA対応エントリーポイント
- `styles/main.css`：エディトリアル調 Vanilla CSS デザインシステム（左手親指操作対応・2列写真グリッド・早め予約レーダー・🏆名作殿堂カード＆ライブ在庫バッジ・フローティングUndoトースト・R18電車モードぼかし）
- `src/app.js` / `src/scarcity-score.js` / `src/isbn-lookup.js` / `src/cover-art.js` / `src/store-links.js` / `src/social-links.js`：ダッシュボードUI・2024〜2026名作所持管理＆在庫フィルタ・売り切れ警戒スコアリング・`amzn.asia`短縮URL展開＆openBDライブ照会・版別棚管理・5ストア検索URL・公式SNSリンク・単体＆一括 `.ics` 生成
- `data/catalog.json`：実在 **145新刊作品** ＋ **38殿堂名作（2024〜2026）**・**324オファー**（非Amazon無特典 0件）・実機検証済み画像242枚
- `scripts/masterpieces-checker.mjs`：2024〜2026殿堂名作の楽天ブックス／セブンネット／丸善ジュンク堂ライブ在庫・レビュー統計チェッカー（レート制限バックオフ対応）
- `scripts/multisite-ingestor.mjs`：キー不要多サイト収集エンジン（版元ドットコム10版元RSS＋openBDバッチ・セブンネット限定表紙/サイン本JSON-LD抽出・HMV Shift_JIS RSS・B.L.T.web RSS）
- `scripts/prtimes-ingestor.mjs`：15出版社PR TIMES RSS精密フィルタ＆記事HTMLメタデータ／限定特典抽出エンジン
- `scripts/rakuten-ingestor.mjs`：楽天ブックスOpenAPI 2026（任意追加用）自動収集＆ノイズゼロ生成エンジン
- `scripts/normalizer.mjs`：複数ストア表記揺れの同一号グルーピング・特典種別抽出・非Amazon無特典除外フィルター
- `scripts/validate-catalog.mjs`：新刊＆名作双方のストアポリシー・画像整合性・ISBN-10チェックサム・HMV NO-IMAGE／403／404検出バリデータ
- `scripts/fetch-catalog.mjs`：毎朝自動更新パイプライン（キー不要5系統＋名作ライブ在庫更新＋任意楽天OpenAPI＋GitHub Actionsサマリー出力）
- `.github/workflows/daily-catalog-update.yml`：毎朝07:00 JST自動更新＋手動実行（`workflow_dispatch`）ワークフロー

## 検証コマンド

```bash
# 正規化・特典抽出・openBD/短縮URL・PR TIMES・多サイト収集・楽天OpenAPI・カタログ整合性の単体テスト
npm test

# カタログのポリシー・ISBN-10・書影整合性チェック（URLライブ疎通チェック付き）
npm run validate
npm run validate:urls

# 収集パイプラインのドライラン検証
npm run collect:dry
```